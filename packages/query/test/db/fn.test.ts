import {
	bigint,
	defineFunction,
	defineTrigger,
	eq,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { FnApi, FnCaller } from "../../src/db/fn";
import type {
	Driver,
	DriverRow,
	DriverSession,
} from "../../src/driver/contract";

/** `noUncheckedIndexedAccess` widens every `FnApi[key]` read to `FnCaller | undefined` (a dynamically-built `Record`, not yet a per-key-typed surface -- that typing is task 4.10's job). Throws instead of a non-null assertion when the fixture itself is wrong. */
const requireFn = (api: FnApi, key: string): FnCaller => {
	const fn = api[key];
	if (fn === undefined) {
		throw new Error(`test fixture is missing db.fn.${key}`);
	}
	return fn;
};

const app = schema("app");

const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
});

const listPublished = defineFunction(
	app,
	"list_published",
	{ returns: posts },
	(ctx) => {
		ctx.return(select(posts));
	},
);

const searchByStatus = defineFunction(
	app,
	"search_by_status",
	{ args: { status: text() }, returns: posts },
	(ctx, args) => {
		ctx.return(select(posts).where(eq(posts.status, args.status)));
	},
);

/**
 * `defineTrigger`'s own function declaration (`returns.returnsKind ===
 * "trigger"`) is never meant to be called directly through SQL -- Postgres
 * only ever invokes it by attaching it to a table trigger. Exposed under a
 * plain export name (`touchTriggerFn`) exactly like any other function
 * declaration, so `db()`'s classification can't tell it apart from a
 * callable one by export name alone -- the rejection has to happen at
 * call time, keyed off `returnsKind` (owner's "explicit SQL over
 * implicit": db.fn never silently no-ops or coerces a trigger call into
 * something else).
 */
const touchTrigger = defineTrigger(
	posts,
	{ name: "posts_touch", timing: "before", events: ["update"], forEach: "row" },
	(ctx, { new: row }) => {
		ctx.return(row);
	},
);

const appSchema = {
	posts,
	listPublished,
	searchByStatus,
	touchTriggerFn: touchTrigger.functionDeclaration,
};

const rawRow = {
	id: "11111111-1111-1111-1111-111111111111",
	status: "draft",
	amount: "9007199254740993",
};

const recordingDriver = (
	rows: ReadonlyArray<DriverRow> = [],
): {
	readonly driver: Driver;
	readonly sent: Array<{ sql: string; params: ReadonlyArray<unknown> }>;
} => {
	const sent: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: vi.fn(async (compiled) => {
			sent.push({ sql: compiled.sql, params: compiled.params });
			return rows;
		}),
		transaction: vi.fn(async (callback) => {
			const session: DriverSession = {
				execute: vi.fn(async (compiled) => {
					sent.push({ sql: compiled.sql, params: compiled.params });
					return rows;
				}),
			};
			return callback(session);
		}),
		setupSession: vi.fn(async () => {}),
	};
	return { driver, sent };
};

describe("db.fn.* (task 4.9)", () => {
	it("is keyed by the declarations record's export name, not the SQL function name", () => {
		const { driver } = recordingDriver();
		const handle = db(appSchema, driver);

		expect(Object.keys(handle.fn)).toEqual([
			"listPublished",
			"searchByStatus",
			"touchTriggerFn",
		]);
	});

	it("a no-arg returns-table call renders an explicit column list, never a star", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);

		await requireFn(handle.fn, "listPublished")([]);

		expect(sent[0]?.sql).toBe(
			'select "id", "status", "amount" from "app"."list_published"()',
		);
		expect(sent[0]?.sql).not.toContain("*");
		expect(sent[0]?.params).toEqual([]);
	});

	it("a parameterized call sends args positionally as bind parameters, never inlined into SQL text", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);
		const marker = "published'; drop table posts --";

		await requireFn(handle.fn, "searchByStatus")([marker]);

		expect(sent[0]?.sql).toBe(
			'select "id", "status", "amount" from "app"."search_by_status"($1)',
		);
		expect(sent[0]?.sql).not.toContain(marker);
		expect(sent[0]?.params).toEqual([marker]);
	});

	it("returns-table rows are converted per the target table's declared columns (numeric mode), same as a whole-table select", async () => {
		const { driver } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);

		const rows = await requireFn(handle.fn, "listPublished")([]);

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("falls back to a bare scalar call when the returns-table's target table isn't in the declarations record (direct branch coverage, not incidental)", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		// deliberately omits `posts` -- listPublished's own declared
		// `returns: posts` table is unresolvable in this handle.
		const handle = db({ listPublished }, driver);

		await requireFn(handle.fn, "listPublished")([]);

		expect(sent[0]?.sql).toBe('select "app"."list_published"()');
		expect(sent[0]?.sql).not.toContain("from");
	});

	it("rejects a wrong argument count before any send", async () => {
		const { driver } = recordingDriver();
		const handle = db(appSchema, driver);

		await expect(requireFn(handle.fn, "searchByStatus")([])).rejects.toThrow(
			/argument/,
		);
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("rejects a call to a trigger-returning function before any send (owner's explicit SQL over implicit)", async () => {
		const { driver } = recordingDriver();
		const handle = db(appSchema, driver);

		try {
			await requireFn(handle.fn, "touchTriggerFn")([]);
			expect.unreachable("db.fn should have rejected a trigger function");
		} catch (error) {
			expect(error).toHaveProperty("code", "function-return-kind-unsupported");
			expect((error as Error).message).toMatch(/Next:/);
		}
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("db.as(context).fn also runs inside that context's wrapping transaction (task 4.7 x 4.9)", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver, { roles: [roleName("app_reader")] });

		const scoped = handle.as({ role: roleName("app_reader") });
		await requireFn(scoped.fn, "listPublished")([]);

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(driver.execute).not.toHaveBeenCalled();
		// role statement first, then the function call -- same transaction.
		expect(sent[0]?.sql).toContain("set local role");
		expect(sent[1]?.sql).toContain("list_published");
	});
});
