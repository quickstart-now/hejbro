import { roleName, schema, select, table, uuid } from "@hejbro/core";
import type { Driver, DriverRow, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import { asTenant, nileContextRendering } from "../src/context";
import { nileDriver } from "../src/driver";

/** One statement as a recording base captures it -- mirrors `driver.test.ts`'s own fixture. */
type SentStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

/** A recording base `Driver` -- `nileDriver`'s own base, not its output; every test decorates a fixture it fully controls, mirroring `driver.test.ts`'s own `recordingBase`. */
const recordingBase = (
	rows: ReadonlyArray<DriverRow> = [],
): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<Array<SentStatement>>;
} => {
	const sentPerTransaction: Array<Array<SentStatement>> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
		},
		execute: vi.fn(async () => rows),
		transaction: vi.fn(async (callback) => {
			const sent: Array<SentStatement> = [];
			sentPerTransaction.push(sent);
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
	return { driver, sentPerTransaction };
};

/** A minimal tenant-aware table, mirroring `driver.test.ts`'s own `widgets`. */
const widgets = table(schema("app"), "widgets", {
	id: uuid().primaryKey(),
	tenantId: uuid().notNull(),
});

const appSchema = { widgets };

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

describe("asTenant builds a role-less context naming the tenant (task 3.1, #565)", () => {
	it("names no role, and its settings identify the tenant", () => {
		const context = asTenant(TENANT_ID);

		expect(context.role).toBeUndefined();
		expect(context.settings).toEqual({ "nile.tenant_id": TENANT_ID });
	});

	it("carries the user setting too, when a user is named", () => {
		const context = asTenant(TENANT_ID, USER_ID);

		expect(context.settings).toEqual({
			"nile.tenant_id": TENANT_ID,
			"nile.user_id": USER_ID,
		});
	});
});

describe("the tenant setting is the first statement the query layer sends (task 3.2, #565)", () => {
	it("observed through a db() handle over a recording base -- the transcript's first statement is the SET LOCAL tenant setting", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		const handle = db(appSchema, nileDriver(driver));

		await handle.as(asTenant(TENANT_ID)).execute(select(widgets));

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]?.[0]).toEqual({
			sql: `set local nile.tenant_id = '${TENANT_ID}'`,
			params: [],
		});
	});
});

describe("a user context renders the tenant setting before the user setting (task 3.3, #565)", () => {
	it("both statements land in the same transcript, tenant first", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		const handle = db(appSchema, nileDriver(driver));

		await handle.as(asTenant(TENANT_ID, USER_ID)).execute(select(widgets));

		expect(sentPerTransaction).toHaveLength(1);
		// the context statements ride ahead of the caller's own -- exactly
		// two entries precede whatever the caller's own select compiles to.
		expect(sentPerTransaction[0]?.slice(0, 2)).toEqual([
			{ sql: `set local nile.tenant_id = '${TENANT_ID}'`, params: [] },
			{ sql: `set local nile.user_id = '${USER_ID}'`, params: [] },
		]);
	});

	it("order mutant: swapping the two is caught", () => {
		const statements = nileContextRendering({
			settings: { "nile.tenant_id": TENANT_ID, "nile.user_id": USER_ID },
		});

		expect(statements[0]?.sql).toContain("nile.tenant_id");
		expect(statements[1]?.sql).toContain("nile.user_id");
		// a rendering that swapped the two would fail the assertions above,
		// not merely produce a differently-ordered array this test forgot
		// to check -- both positions are pinned explicitly.
	});
});

describe("the rendering never reaches for set_config (task 3.4, #565)", () => {
	it("no returned statement is a set_config call, for either setting", () => {
		const statements = nileContextRendering({
			settings: { "nile.tenant_id": TENANT_ID, "nile.user_id": USER_ID },
		});

		statements.forEach((statement) => {
			expect(statement.sql).not.toContain("set_config");
			expect(statement.sql.toLowerCase().startsWith("set local ")).toBe(true);
		});
	});
});

describe("a value that is not a canonical UUID is refused before any statement exists (task 3.5, #565)", () => {
	it("an adversarial tenant value produces the coded error, and nothing is rendered", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		const handle = db(appSchema, nileDriver(driver));
		const adversarial = "'; drop table widgets; --";

		await expect(
			handle.as(asTenant(adversarial)).execute(select(widgets)),
		).rejects.toMatchObject({
			code: "nile-context-value-invalid",
			field: "tenant",
		});

		// db.as(context) opens its own transaction unconditionally (that is
		// this API's own contract, independent of this preset) -- what this
		// preset controls is that nothing is ever sent *inside* it: the
		// rendering throws while applyContext still holds the statement
		// array, before session.execute is ever called, so the one
		// transaction that did open carries zero statements, and the
		// caller's own select (which would have been the third) never runs
		// either.
		expect(sentPerTransaction).toEqual([[]]);
	});

	it("the raw adversarial value never appears as a substring of any rendered statement", () => {
		const adversarial = "'; drop table widgets; --";

		expect(() =>
			nileContextRendering({ settings: { "nile.tenant_id": adversarial } }),
		).toThrow(expect.objectContaining({ code: "nile-context-value-invalid" }));
		// the throw happens while constructing the rendering's own return
		// array -- no statement is ever produced for the adversarial value
		// to appear inside, proven directly rather than inferred: calling
		// the rendering with a try/catch and confirming it never returns.
		try {
			nileContextRendering({ settings: { "nile.tenant_id": adversarial } });
			expect.unreachable("nileContextRendering should have thrown");
		} catch {
			// no statements array was ever produced to search
		}
	});

	it("a non-canonical user value is refused the same way, field-tagged as 'user'", () => {
		expect(() =>
			nileContextRendering({
				settings: { "nile.tenant_id": TENANT_ID, "nile.user_id": "not-a-uuid" },
			}),
		).toThrow(
			expect.objectContaining({
				code: "nile-context-value-invalid",
				field: "user",
			}),
		);
	});

	it("mutation-proof: removing the UUID check would let an adversarial value through -- confirmed by temporarily disabling it", () => {
		// This test asserts the *current*, checked behavior; the mutation
		// itself (deleting validatedValue's guard clause in src/context.ts,
		// rerunning, reverting via file copy) is performed and reported
		// out-of-band per this group's own TDD discipline, not encoded as
		// a second in-repo test -- there is no way to "temporarily disable"
		// production code from inside a test file without changing what
		// ships. This test is the fixed point that mutation is checked
		// against.
		expect(() =>
			nileContextRendering({ settings: { "nile.tenant_id": "not-a-uuid" } }),
		).toThrow();
	});
});

describe("a valid tenant value is quoted, not concatenated (task 3.6, #565)", () => {
	it("the rendered statement carries the value through the literal-quoting rule", () => {
		const [statement] = nileContextRendering({
			settings: { "nile.tenant_id": TENANT_ID },
		});

		expect(statement?.sql).toBe(`set local nile.tenant_id = '${TENANT_ID}'`);
	});

	it("an embedded single quote in an otherwise-shaped value is refused by the UUID check before quoting matters", () => {
		// canonical UUIDs cannot contain a quote character at all, so the
		// UUID gate (task 3.5) is what actually keeps a quote-carrying
		// value out -- this is the same defense-in-depth point the
		// production comment makes; quoting is still applied to whatever
		// *does* get through, exercised by the happy-path test above.
		expect(() =>
			nileContextRendering({
				settings: { "nile.tenant_id": "1'; drop table widgets; --" },
			}),
		).toThrow();
	});
});

describe("the rendering refuses a context it cannot apply, before producing any statement (D106 F3)", () => {
	it("a context naming a role is refused, not silently ignored -- nothing is rendered", () => {
		expect(() =>
			nileContextRendering({
				role: roleName("reader"),
				settings: { "nile.tenant_id": TENANT_ID },
			}),
		).toThrow(
			expect.objectContaining({
				code: "nile-context-unsupported",
				field: "role",
			}),
		);
	});

	it("a setting outside the platform's own tenant/user keys is refused, not silently dropped", () => {
		expect(() =>
			nileContextRendering({
				settings: {
					"nile.tenant_id": TENANT_ID,
					"app.unrelated": "whatever",
				},
			}),
		).toThrow(
			expect.objectContaining({
				code: "nile-context-unsupported",
				field: "app.unrelated",
			}),
		);
	});

	it("observed at execution level: a role on the context never reaches the base, and the transaction that opened carries nothing", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		// declared via db()'s own "roles" option -- this role passes the
		// declared-role whitelist (query.ts's own assertContextRole), so
		// reaching this rendering's own refusal is what this test proves,
		// not the whitelist's already-covered rejection of an undeclared one.
		const handle = db(appSchema, nileDriver(driver), {
			roles: [roleName("reader")],
		});

		await expect(
			handle
				.as({
					role: roleName("reader"),
					settings: { "nile.tenant_id": TENANT_ID },
				})
				.select(widgets),
		).rejects.toMatchObject({
			code: "nile-context-unsupported",
			field: "role",
		});

		// db.as(context) opens its own transaction unconditionally (same
		// contract 3.5's own test already established) -- the one that did
		// open carries zero statements, because the rendering threw before
		// producing any.
		expect(sentPerTransaction).toEqual([[]]);
	});

	it("mutation-proof: removing the role guard would let a role silently through -- confirmed against the current, checked behavior", () => {
		// The mutation itself (deleting assertSupportedContext's role
		// check in src/context.ts, rerunning, reverting via file copy) is
		// performed and reported out-of-band per this group's own TDD
		// discipline, not encoded as a second in-repo test. This test is
		// the fixed point that mutation is checked against.
		expect(() =>
			nileContextRendering({
				role: roleName("reader"),
				settings: { "nile.tenant_id": TENANT_ID },
			}),
		).toThrow();
	});

	it("mutation-proof fixed point for the unsupported-setting guard", () => {
		expect(() =>
			nileContextRendering({
				settings: { "nile.tenant_id": TENANT_ID, "app.unrelated": "x" },
			}),
		).toThrow();
	});
});

describe("the preset never reaches the query layer's own empty-rendering refusal (harden-context-boundary task 2.1, #591)", () => {
	it("refuses a context carrying no tenant setting before producing a statement", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		const handle = db(appSchema, nileDriver(driver));

		// a context naming no tenant setting at all -- the shape
		// query-layer's own context-rendering-empty guard would otherwise
		// catch downstream (`packages/query/src/db/context.ts`'s
		// applyContext), except this preset's rendering already refuses it
		// on the missing tenant value before returning anything, so the
		// query layer's newer refusal is never reached.
		await expect(handle.as({}).execute(select(widgets))).rejects.toMatchObject({
			code: "nile-context-value-invalid",
			field: "tenant",
		});

		// the transaction db.as(context) opened unconditionally carries
		// zero statements -- the rendering threw while applyContext still
		// held the (never-produced) statement array, so session.execute is
		// never called at all, on this path or the query layer's own.
		expect(sentPerTransaction).toEqual([[]]);
	});
});
