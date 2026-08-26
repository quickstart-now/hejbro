import { schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "../../src/compile/compile";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";
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
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: vi.fn(async (compiled: CompileResult) => {
			received.push(compiled);
			return [];
		}),
		transaction: vi.fn(async (callback) =>
			callback({ execute: vi.fn(async () => []) }),
		),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, received };
};

describe("db().execute (task 4.3)", () => {
	it("executed SQL equals previewed compile output -- sql, params, and kind all three, byte-identical", async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ tables: { posts } }, driver);
		const statement = select(posts);
		const preview = compile(statement);

		await handle.execute(statement);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(preview);
		expect(received[0]?.sql).toBe(preview.sql);
		expect(received[0]?.params).toEqual(preview.params);
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	it('kind flows through unchanged for every CompileKind -- not hardcoded to "select" (g2 added a fifth value, "sql")', async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ tables: { posts } }, driver);

		await handle.execute(select(posts));
		await handle.execute(sql`select 1`);

		expect(received[0]?.kind).toBe("select");
		expect(received[1]?.kind).toBe("sql");
	});

	it("also accepts a bare QueryNode, exactly like compile() itself (same CompileInput contract)", async () => {
		const { driver, received } = recordingDriver();
		const handle = db({ tables: { posts } }, driver);
		const bareNode = select(posts).selectQuery;

		await handle.execute(bareNode);

		expect(received[0]).toEqual(compile(bareNode));
	});
});
