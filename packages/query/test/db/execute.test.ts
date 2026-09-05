import {
	and,
	eq,
	ne,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "../../src/compile/compile";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import type { Driver, DriverSession } from "../../src/driver/contract";
import { sql } from "../../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

/** A driver whose `execute` records exactly what it was handed, so a test can compare it against `compile()`'s own preview. */
const recordingDriver = (): {
	readonly driver: Driver;
	readonly received: Array<CompileResult>;
} => {
	const received: Array<CompileResult> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: vi.fn(async (compiled: CompileResult) => {
			received.push(compiled);
			return [];
		}),
		transaction: vi.fn(async (callback) =>
			callback({ execute: vi.fn(async () => []) }),
		),
		batch: vi.fn(async () => []),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, received };
};

describe("db().execute (task 4.3)", () => {
	it("executed SQL equals previewed compile output -- sql, params, and kind all three, byte-identical (a statement that actually carries params, not the empty-array vacuous case)", async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ posts }, driver);
		// two distinct, order-sensitive param values -- a bare select(posts)
		// compiles to params: [], which would let a driver.execute(sql, [])
		// regression pass unnoticed (batch A review, probe 6).
		const statement = select(posts).where(
			and(eq(posts.status, "published"), ne(posts.id, "not-this-one")),
		);
		const preview = compile(statement);

		await handle.execute(statement);

		expect(preview.params).toEqual(["published", "not-this-one"]);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(preview);
		expect(received[0]?.sql).toBe(preview.sql);
		expect(received[0]?.params).toEqual(["published", "not-this-one"]);
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	it("param order is preserved, not just param presence (a reversed-params mutant must fail this)", async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ posts }, driver);
		const statement = select(posts).where(
			and(eq(posts.status, "first-value"), ne(posts.id, "second-value")),
		);

		await handle.execute(statement);

		// index-by-index, not just set membership -- toEqual on an array
		// already checks order, but this makes the intent explicit and
		// would also survive a future switch to a looser matcher.
		expect(received[0]?.params[0]).toBe("first-value");
		expect(received[0]?.params[1]).toBe("second-value");
	});

	it('kind flows through unchanged for every CompileKind -- not hardcoded to "select" (g2 added a fifth value, "sql")', async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ posts }, driver);

		await handle.execute(select(posts));
		await handle.execute(sql`select 1`);

		expect(received[0]?.kind).toBe("select");
		expect(received[1]?.kind).toBe("sql");
	});

	it("also accepts a bare QueryNode, exactly like compile() itself (same CompileInput contract)", async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ posts }, driver);
		const bareNode = select(posts).selectQuery;

		await handle.execute(bareNode);

		expect(received[0]).toEqual(compile(bareNode));
	});
});

/**
 * Same recording contract as {@link recordingDriver} above, but models one
 * BEGIN/COMMIT per `driver.transaction()` call and records every statement
 * sent on that connection, in order, as a full `CompileResult` (kind
 * included) -- needed to prove a context-applied handle's own statement is
 * unchanged relative to `compile()` AND that the context's own statements
 * precede it on the SAME transaction (task 1.6, #452, the context-applied
 * half of the preview-equals-executed claim `recordingDriver`'s own
 * `transaction` stub can't observe: that stub never records what runs
 * inside it at all).
 */
const recordingContextDriver = (): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<Array<CompileResult>>;
} => {
	const sentPerTransaction: Array<Array<CompileResult>> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: vi.fn(async () => []),
		transaction: vi.fn(async (callback) => {
			const sent: Array<CompileResult> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: vi.fn(async (compiled: CompileResult) => {
					sent.push(compiled);
					return [];
				}),
			};
			return callback(session);
		}),
		batch: vi.fn(async () => []),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, sentPerTransaction };
};

describe("db().execute under an applied execution context (task 1.6, #452)", () => {
	it("executed SQL equals previewed compile output under an applied execution context", async () => {
		const { driver, sentPerTransaction } = recordingContextDriver();
		const handle = db({ posts }, driver, { roles: [roleName("app_admin")] });
		// a statement that actually carries params, not the empty-array
		// vacuous case -- same reasoning as the context-less case above.
		const statement = select(posts).where(
			and(eq(posts.status, "published"), ne(posts.id, "not-this-one")),
		);
		const preview = compile(statement);

		await handle.as({ role: roleName("app_admin") }).execute(statement);

		expect(sentPerTransaction).toHaveLength(1);
		const sent = sentPerTransaction[0] ?? [];
		// the context's own role statement precedes the caller's statement
		// on the same transaction, rather than altering it -- the caller's
		// own statement is byte-identical to compile()'s preview, sql,
		// params and kind all three.
		expect(sent).toHaveLength(2);
		expect(sent[0]?.sql).toBe('set local role "app_admin"');
		expect(sent[1]).toEqual(preview);
	});
});
