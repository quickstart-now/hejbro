import { roleName, schema, select, table, uuid } from "@hejbro/core";
import type {
	ContextRendering,
	Driver,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it, vi } from "vitest";
import { nileDriver } from "../src/driver";

/** One statement as a recording base captures it -- `sql`/`params` only, mirroring `packages/supabase/test/driver.test.ts`'s own fixture shape. */
type SentStatement = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

type RecordingBaseOptions = {
	readonly interactiveTransactions?: boolean;
	readonly renderContext?: ContextRendering;
	readonly rows?: ReadonlyArray<DriverRow>;
	/**
	 * Models a base driver that pins its own session at connection
	 * checkout (task 2.3, #564) -- sent through a channel that never lands
	 * in `sentPerTransaction`, mirroring how `@hejbro/pg`/`@hejbro/neon`'s
	 * own checkout guard pins the raw connection before `BEGIN`, never on
	 * the `DriverSession` a `transaction()` callback receives. Recorded
	 * separately (`checkoutPins`) so a test can assert it never appears in
	 * the in-transaction transcript, without asserting it never happened
	 * at all.
	 */
	readonly checkoutPin?: SentStatement;
};

/** `{ renderContext }` when given a value, or `{}` when omitted -- avoids ever spreading an explicit `renderContext: undefined` (`exactOptionalPropertyTypes`), mirroring `packages/query/test/db/recording-driver.ts`'s own per-field guard-clause helpers. */
const renderContextField = (
	renderContext: ContextRendering | undefined,
): Pick<Driver, "renderContext"> | Record<string, never> => {
	if (renderContext === undefined) {
		return {};
	}
	return { renderContext };
};

/**
 * A recording base `Driver` -- not `nileDriver`'s own output -- so every
 * test in this file decorates a fixture it fully controls, exactly like
 * `packages/supabase/test/driver.test.ts`'s own `fakeDriver`/
 * `recordingTransactionalDriver` pair.
 */
const recordingBase = (
	options: RecordingBaseOptions = {},
): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<Array<SentStatement>>;
	readonly checkoutPins: Array<SentStatement>;
} => {
	const rows = options.rows ?? [];
	const sentPerTransaction: Array<Array<SentStatement>> = [];
	const checkoutPins: Array<SentStatement> = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": options.interactiveTransactions ?? true,
			"session-state": true,
		},
		execute: vi.fn(async () => rows),
		transaction: vi.fn(async (callback) => {
			if (options.checkoutPin !== undefined) {
				checkoutPins.push(options.checkoutPin);
			}
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
		...renderContextField(options.renderContext),
	};
	return { driver, sentPerTransaction, checkoutPins };
};

/** A minimal tenant-aware table -- a plain `tenant_id uuid` column, no RLS/grant/function declaration (proposal.md: "an ordinary CREATE TABLE... Core already expresses that"). No role is granted, so `declaredRoles` is empty on purpose -- task 2.4's "named role outside the union" case needs a whitelist that admits none. */
const widgets = table(schema("app"), "widgets", {
	id: uuid().primaryKey(),
	tenantId: uuid().notNull(),
});

const appSchema = { widgets };

describe("nileDriver(driver) forwards execute/transaction/setupSession untouched (task 2.1, #564)", () => {
	it("a recording base sees exactly what the caller sent to execute, and nothing else", async () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);

		await wrapped.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(driver.execute).toHaveBeenCalledTimes(1);
		expect(driver.execute).toHaveBeenCalledWith({
			sql: "select 1",
			params: [],
			kind: "sql",
		});
	});

	it("transaction is the base driver's own -- forwarded by reference, not reimplemented", () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);

		expect(wrapped.transaction).toBe(driver.transaction);
	});

	it("setupSession is the base driver's own -- forwarded by reference, not reimplemented", () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);

		expect(wrapped.setupSession).toBe(driver.setupSession);
	});

	it("every base member the contract carries passes through by reference, except the three fields this decorator itself owns", () => {
		// renderContext joined roleLessPlatform/contextRequired here in
		// group 3 (task 3.2, lead-approved addition to this group's own
		// file list): the driver owns its own rendering (#553's own
		// contract), so a base driver's own renderContext (if it carries
		// one at all) is never the platform's own -- this decorator always
		// substitutes nileContextRendering for it, the same as it always
		// substitutes its own two declarations.
		const baseRenderContext = () => [];
		const { driver } = recordingBase({
			renderContext: baseRenderContext,
		});
		const wrapped = nileDriver(driver);
		const ownFields: ReadonlySet<keyof Driver> = new Set([
			"renderContext",
			"roleLessPlatform",
			"contextRequired",
		]);

		(Object.keys(driver) as ReadonlyArray<keyof Driver>)
			.filter((key) => !ownFields.has(key))
			.forEach((key) => {
				expect(wrapped[key]).toBe(driver[key]);
			});
		expect(wrapped.renderContext).not.toBe(baseRenderContext);
	});
});

describe("nileDriver(driver) forwards capabilities unchanged (task 2.2, #564)", () => {
	it("reads exactly as the base driver's own capabilities, by reference", () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);

		expect(wrapped.capabilities).toBe(driver.capabilities);
	});

	it("a base without interactive transactions still refuses a context, and the rendering is never invoked", async () => {
		const { driver } = recordingBase({ interactiveTransactions: false });
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		await expect(
			handle.as({ settings: {} }).execute(select(widgets)),
		).rejects.toMatchObject({ code: "driver-missing-capability" });

		// the rendering (nileContextRendering, since group 3 -- task 3.2)
		// only ever runs inside a transaction the base opens; proving the
		// base's own transaction was never called is proof enough that the
		// rendering was never reached, without needing a way to spy on the
		// module-level export directly.
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("nileDriver(driver) sends nothing of its own ahead of the caller's transaction callback (task 2.3, #564)", () => {
	it("the in-transaction transcript starts with the context's own rendering, and carries no base-driver statement ahead of it -- a base that pins at connection checkout stays supported", async () => {
		// nileDriver always supplies its own renderContext since group 3
		// (task 3.2) -- this is the real nileContextRendering now, not a
		// stub, so the expected statement below is that rendering's actual
		// SET LOCAL output for this tenant value.
		const tenantSetting: SentStatement = {
			sql: "set local nile.tenant_id = '11111111-1111-1111-1111-111111111111'",
			params: [],
		};
		const checkoutPin: SentStatement = {
			sql: "set intervalstyle to 'postgres'",
			params: [],
		};
		const { driver, sentPerTransaction, checkoutPins } = recordingBase({
			checkoutPin,
		});
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		await handle
			.as({
				settings: { "nile.tenant_id": "11111111-1111-1111-1111-111111111111" },
			})
			.execute(select(widgets));

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]?.[0]).toEqual(tenantSetting);
		expect(sentPerTransaction[0]).not.toContainEqual(checkoutPin);
		// the checkout pin still happened (this base genuinely pins at
		// checkout) -- it is simply outside the transcript this decorator's
		// own guarantee is scoped to, exactly as a real checkout pin would
		// be sent before BEGIN, on the raw connection.
		expect(checkoutPins).toEqual([checkoutPin]);
	});
});

describe("nileDriver's two platform declarations (task 2.4, #564)", () => {
	it("both are readable as data before any connection", () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);

		expect(wrapped.roleLessPlatform).toBe(true);
		expect(wrapped.contextRequired).toBe(true);
		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("a named role outside the declared-role union is still refused -- roleLessPlatform grants no exemption", () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		// db.as(context) validates a named role synchronously, before any
		// I/O (context.ts's own `createAsApi`) -- it throws while the
		// expression is still being evaluated, not from a rejected promise,
		// mirroring packages/query/test/db/context.test.ts's own
		// "a named role stays validated even on a role-less driver" case.
		try {
			handle.as({ role: roleName("nonexistent_role") });
			expect.unreachable("db.as should have thrown");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
		}

		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("an uncontexted execution is refused with context-required, and nothing reaches the base", async () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		await expect(handle.execute(select(widgets))).rejects.toMatchObject({
			code: "context-required",
		});

		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("a role-less context actually runs and reaches the base -- the platform declares itself role-less, and this context names no role", async () => {
		const { driver, sentPerTransaction } = recordingBase();
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		await handle
			.as({
				settings: { "nile.tenant_id": "11111111-1111-1111-1111-111111111111" },
			})
			.execute(select(widgets));

		expect(sentPerTransaction).toHaveLength(1);
	});

	it("a catalog-shaped read issued through the handle's driver member still reaches the base -- what makes the mandatory context safe for the schema check", async () => {
		const { driver } = recordingBase();
		const wrapped = nileDriver(driver);
		const handle = db(appSchema, wrapped);

		await handle.driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(driver.execute).toHaveBeenCalledTimes(1);
	});
});

describe("the manifest declares no Nile client dependency (task 2.5, #564)", () => {
	it("no @niledatabase/* entry appears in any dependency field", async () => {
		const manifest = await import("../package.json", {
			with: { type: "json" },
		});
		const fields = [
			"dependencies",
			"devDependencies",
			"peerDependencies",
			"optionalDependencies",
		] as const;

		const niledatabaseEntries = fields.flatMap((field) => {
			const table = (manifest.default as Record<string, unknown>)[field] as
				| Record<string, string>
				| undefined;
			if (table === undefined) {
				return [];
			}
			return Object.keys(table).filter((name) =>
				name.startsWith("@niledatabase/"),
			);
		});

		expect(niledatabaseEntries).toEqual([]);
	});
});
