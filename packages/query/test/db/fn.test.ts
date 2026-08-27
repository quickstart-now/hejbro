import {
	bigint,
	defineFunction,
	defineTrigger,
	eq,
	getTableMeta,
	integer,
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

/** Only needed where a test deliberately bypasses the typed `db.fn` surface (task 4.10) to exercise the runtime's own defense-in-depth against a caller who bypassed TypeScript -- every other test below calls through the real, precisely-typed `handle.fn.xxx(...)` directly. Throws instead of a non-null assertion when the fixture itself is wrong. */
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
 * Two arguments of *different* families (`text`/`integer`) with
 * distinguishable values, for the named-argument key-order test below --
 * same-type arguments could silently swap without either the SQL or a
 * `params` assertion noticing (batch A's own params-vacuity lesson,
 * repeated here at the argument-mapping layer).
 */
const searchByStatusAndLimit = defineFunction(
	app,
	"search_by_status_and_max_rows",
	{ args: { status: text(), maxRows: integer() }, returns: posts },
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
 *
 * **Known, pre-existing type limitation** (not introduced by task 4.10):
 * `defineTrigger`'s own `functionDeclaration` field is typed as the bare,
 * non-generic `FunctionDeclaration` (its widest possible instantiation,
 * `define-trigger.ts`, out of this task's file scope), so
 * `FnCallerFor`/`FnResult` can't narrow this one specific declaration
 * down to "never callable" the way they can for anything built directly
 * through `defineFunction`. `db.fn.touchTriggerFn({})` therefore still
 * type-checks (loosely) even though `fn.ts`'s own runtime guard
 * unconditionally rejects it -- the runtime rejection below is real,
 * only the static one is what's missing.
 */
const touchTrigger = defineTrigger(
	posts,
	{ name: "posts_touch", timing: "before", events: ["update"], forEach: "row" },
	(ctx, { new: row }) => {
		ctx.return(row);
	},
);

/**
 * A genuinely scalar-returning `defineFunction` (`returns: {typeName:
 * "bigint"}`, a plain `TypeNode` literal, not a table) -- previously
 * exercised nowhere in the whole codebase (core's own test suite, this
 * package's, or `examples/`), confirmed by a repo-wide search before
 * writing this fixture. The body callback is empty: `db.fn`'s own SQL
 * never renders this declaration's body (that's DDL generation, a
 * separate concern `renderFunctionSql` owns), so there's nothing this
 * fixture needs `ctx.return()` for.
 */
const countPosts = defineFunction(
	app,
	"count_posts",
	{ returns: { typeName: "bigint" } },
	() => {},
);

const appSchema = {
	posts,
	listPublished,
	searchByStatus,
	searchByStatusAndLimit,
	countPosts,
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
			"searchByStatusAndLimit",
			"countPosts",
			"touchTriggerFn",
		]);
	});

	it("a no-arg returns-table call renders an explicit column list, never a star", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);

		await handle.fn.listPublished({});

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

		await handle.fn.searchByStatus({ status: marker });

		expect(sent[0]?.sql).toBe(
			'select "id", "status", "amount" from "app"."search_by_status"($1)',
		);
		expect(sent[0]?.sql).not.toContain(marker);
		expect(sent[0]?.params).toEqual([marker]);
	});

	it("named args resolve to positional SQL parameters in DECLARED order, regardless of call-site key order", async () => {
		const { driver, sent } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);

		// declared order is (status, maxRows); called in the REVERSE order.
		await handle.fn.searchByStatusAndLimit({
			maxRows: 10,
			status: "published",
		});

		expect(sent[0]?.sql).toBe(
			'select "id", "status", "amount" from "app"."search_by_status_and_max_rows"($1, $2)',
		);
		// the assertion that actually matters: params, not SQL text -- "$1,
		// $2" renders identically whether or not the two got swapped
		// (batch A's params-vacuity lesson, repeated at this layer).
		expect(sent[0]?.params).toEqual(["published", 10]);
	});

	it("returns-table rows are converted per the target table's declared columns (numeric mode), same as a whole-table select", async () => {
		const { driver } = recordingDriver([rawRow]);
		const handle = db(appSchema, driver);

		// the typed db.fn surface (fn-types.ts, task 4.10) already resolves
		// this to ReadonlyArray<SelectResult<typeof posts>> -- no cast
		// needed, unlike before 4.10 landed.
		const rows = await handle.fn.listPublished({});

		expect(rows[0]?.amount).toBe(9007199254740993n);
		expect(typeof rows[0]?.amount).toBe("bigint");
	});

	it("fails fast, never a silent scalar guess, when the returns-table's target table isn't declared in this handle's own schema module (owner's explicit over implicit, task 4.9-fallback)", async () => {
		const { driver } = recordingDriver([{ result: "42" }]);
		// deliberately omits `posts` -- listPublished's own declared
		// `returns: posts` table is unresolvable in this handle. This used
		// to silently fall back to an untyped scalar call (task 4.9) --
		// exactly the "type lies" shape 4.4-wiring and the missing-
		// "result"-key guard both already existed to rule out elsewhere
		// (the declared type still promises ReadonlyArray<SelectResult<
		// typeof posts>>, task 4.10, regardless of which handle calls it).
		const handle = db({ listPublished }, driver);

		try {
			await handle.fn.listPublished({});
			expect.unreachable(
				"db.fn should have rejected the undeclared target table",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "function-target-table-undeclared");
			expect((error as Error).message).toMatch(/Next:/);
			expect((error as Error).message).toContain("app.posts");
		}
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("rejects a wrong argument count before any send (runtime defense in depth for a caller who bypassed TypeScript)", async () => {
		const { driver } = recordingDriver();
		const handle = db(appSchema, driver);
		// deliberately bypasses the typed surface -- a missing required key
		// is task 4.10's own compile-time job (see fn-types.test.ts); this
		// checks the runtime still refuses if that check is ever bypassed.
		const looseFn = handle.fn as unknown as FnApi;

		await expect(requireFn(looseFn, "searchByStatus")({})).rejects.toThrow(
			/argument/,
		);
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("a scalar-returning function resolves to the converted value itself, not a rows array (spec: 'resolves to a value')", async () => {
		const { driver, sent } = recordingDriver([{ result: "9007199254740993" }]);
		const handle = db(appSchema, driver);

		const value = await handle.fn.countPosts({});

		expect(sent[0]?.sql).toBe('select "app"."count_posts"() as "result"');
		// the declared bigint mode is honored even though there's no real
		// column behind this value, exactly as ScalarReturnTsType promises.
		expect(value).toBe(9007199254740993n);
		expect(Array.isArray(value)).toBe(false);
	});

	it("core's default bigint mode and fn.ts's own scalar-return mirror move together (#310 drift guard)", async () => {
		// core's own resolved default mode for a bigint column that never
		// spelled an explicit mode -- read through core's public
		// getTableMeta, never hand-typed here, so this reflects whatever
		// core's own default constant actually resolves to right now, not
		// what this test assumes it resolves to.
		const modeProbe = table(app, "mode_probe", { value: bigint() });
		const [probeColumn] = getTableMeta(modeProbe).columns;
		const coreDefaultMode = probeColumn?.columnState.mode;

		const { driver } = recordingDriver([{ result: "9007199254740993" }]);
		const handle = db(appSchema, driver);
		const value = await handle.fn.countPosts({});

		// fn.ts's own defaultNumericMode has no column to read a mode from
		// for a scalar return -- it must independently agree with whatever
		// core just resolved above. Branching the expected runtime shape on
		// the *observed* coreDefaultMode (not a hand-typed "bigint" literal)
		// is what makes this a real drift guard: if fn.ts's own mirror ever
		// disagrees with core's actual default, the branch taken here still
		// won't match the runtime value's own typeof, and this goes red --
		// a hand-pinned literal on both sides could drift together and stay
		// green, this can't.
		if (coreDefaultMode === "bigint") {
			expect(typeof value).toBe("bigint");
		} else if (coreDefaultMode === "number") {
			expect(typeof value).toBe("number");
		} else {
			expect(typeof value).toBe("string");
		}
	});

	it('a scalar call fails fast when the driver doesn\'t return exactly one row with a "result" column', async () => {
		const { driver } = recordingDriver([]);
		const handle = db(appSchema, driver);

		try {
			await handle.fn.countPosts({});
			expect.unreachable("db.fn should have rejected a missing scalar result");
		} catch (error) {
			expect(error).toHaveProperty("code", "function-scalar-result-missing");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it('the scalar-result guard fires on a result-less row (#315 deferred branch: exactly one row, but no "result" key)', async () => {
		// distinct from the zero-rows case above: this exercises the guard's
		// own `!("result" in row)` branch specifically -- a driver that
		// returned exactly one row, just not the one this call promised.
		const { driver } = recordingDriver([{ unrelated: "value" }]);
		const handle = db(appSchema, driver);

		try {
			await handle.fn.countPosts({});
			expect.unreachable(
				'db.fn should have rejected a row missing the "result" column',
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "function-scalar-result-missing");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it("the scalar-result guard fires when the driver returns more than one row (#315 deferred branch)", async () => {
		// distinct from both the zero-rows case above and the result-less-row
		// case above -- this exercises the guard's own `rows.length !== 1`
		// branch on the "too many", not "too few", side.
		const { driver } = recordingDriver([{ result: "1" }, { result: "2" }]);
		const handle = db(appSchema, driver);

		try {
			await handle.fn.countPosts({});
			expect.unreachable(
				"db.fn should have rejected more than one row for a scalar call",
			);
		} catch (error) {
			expect(error).toHaveProperty("code", "function-scalar-result-missing");
			expect((error as Error).message).toMatch(/Next:/);
		}
	});

	it("rejects a call to a trigger-returning function before any send (owner's explicit SQL over implicit)", async () => {
		const { driver } = recordingDriver();
		const handle = db(appSchema, driver);

		try {
			await handle.fn.touchTriggerFn({});
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
		await scoped.fn.listPublished({});

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(driver.execute).not.toHaveBeenCalled();
		// role statement first, then the function call -- same transaction.
		expect(sent[0]?.sql).toContain("set local role");
		expect(sent[1]?.sql).toContain("list_published");
	});
});
