import { randomUUID } from "node:crypto";
import {
	bigint,
	emptySnapshot,
	eq,
	generateMigration,
	grant,
	integer,
	interval,
	literal,
	numeric,
	rls,
	schema,
	select,
	table,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { db } from "@hejbro/query";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUid } from "../../src/auth";
import { neonAuth } from "../../src/context";
import { neonDriver } from "../../src/driver";
import { anonymousRole, authenticatedRole } from "../../src/roles";

/**
 * The local stack's WebSocket proxy, overridable so this witness can run
 * against a differently-mapped stack without editing the file (task 7.2).
 * `/v1`, not the client's default `/v2` -- and `APPEND_PORT` is left
 * unset entirely -- both measured (`design.md`'s trap 1/2): the default
 * route 404s against the open-source proxy, and setting `APPEND_PORT`
 * duplicates the address the client already sends.
 */
const PROXY_HOST = process.env.NEON_WITNESS_WS_PROXY ?? "localhost:5433";
neonConfig.wsProxy = (host, port) => `${PROXY_HOST}/v1?address=${host}:${port}`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineConnect = false;

const CONNECTION_STRING =
	process.env.NEON_WITNESS_CONNECTION_STRING ??
	"postgres://postgres:postgres@ne-pg:5432/main";

/**
 * Names the exact commands `design.md`'s "Reproduction" section documents
 * -- never a skip (task 7.2). A witness that quietly skips when the stack
 * is absent stops being a witness; this suite would report green having
 * proven nothing.
 */
const STACK_MISSING_GUIDANCE = `packages/neon's local witness needs a running Neon stack: postgres:17 + the official wsproxy image + a locally built pg_session_jwt, network-joined, with pg_session_jwt installed. Next: follow design.md's "Reproduction" section (openspec/changes/add-neon-preset/design.md) to build the stack, or override NEON_WITNESS_WS_PROXY/NEON_WITNESS_CONNECTION_STRING if yours is mapped differently, then re-run \`pnpm --filter @hejbro/neon test:integration\`.`;

const app = schema("app");

const OWNER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER_B = "bbbbbbbb-0000-4000-8000-000000000002";

/** Identity-keyed: only rows whose owner matches `auth.uid()` are visible. */
const identityGated = table(
	app,
	"identity_gated",
	{
		id: uuid().primaryKey().defaultRandom(),
		ownerId: uuid().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			ownerOnly: rls
				.policy("identity_gated_owner_only")
				.for("select")
				.to(authenticatedRole)
				.using(eq(t.ownerId, authUid())),
		}),
	}),
);

/** Role-keyed only: every row is visible to any authenticated context, identity never checked -- the dangerous half task 7.5 witnesses. */
const roleGated = table(
	app,
	"role_gated",
	{
		id: uuid().primaryKey().defaultRandom(),
	},
	() => ({
		rls: rls.enabled({
			anySignedIn: rls
				.policy("role_gated_any_signed_in")
				.for("select")
				.to(authenticatedRole)
				.using(literal(true)),
		}),
	}),
);

/**
 * Arrival-shape witness table (task 7.7, extended by 7.8) -- the types
 * whose parsers most plausibly differ between `pg-types` and
 * `@neondatabase/serverless`'s own bundled set. Task 7.7's original four
 * columns (bigint/numeric scalar/timestamptz/integer[]) all fall through
 * to the client's own default parser -- none of them exercise the three
 * oids `type-overrides.ts` actually overrides (1186 interval, 1187
 * interval[], 1231 numeric[]), so a live-data bug in the override itself
 * (present but wrong, not merely missing) had nothing here to catch it
 * (measured: reviewer's "drop the interval/numeric[] oid from the
 * override" mutants both survived this file before 7.8). `duration` and
 * `durations` and `precisions` close that gap.
 */
const shapes = table(app, "shapes", {
	id: uuid().primaryKey().defaultRandom(),
	amount: bigint({ mode: "number" }).notNull(),
	precise: numeric({ mode: "string" }).notNull(),
	seenAt: timestamptz().notNull(),
	tags: integer().array().notNull(),
	duration: interval().notNull(),
	durations: interval().array().notNull(),
	precisions: numeric({ mode: "string" }).array().notNull(),
});

const declarations = { identityGated, roleGated, shapes };

const migrationSql = generateMigration({
	declarations: [
		app,
		identityGated,
		roleGated,
		shapes,
		grant(app).usage.to(authenticatedRole, anonymousRole),
		grant(app).tables("select").to(authenticatedRole, anonymousRole),
	],
	previousSnapshot: emptySnapshot,
}).sql;

describe("Neon WebSocket local witness (group 7)", () => {
	const poolRef: { current: Pool | undefined } = { current: undefined };

	beforeAll(async () => {
		const pool = new Pool({ connectionString: CONNECTION_STRING, max: 1 });
		try {
			const probe = await pool.connect();
			probe.release();
		} catch (error) {
			await pool.end();
			// Never a bare "Original error:" label with nothing after it --
			// an empty message from the underlying connection failure would
			// otherwise leave a reader wondering where the original error
			// went, adding confusion to guidance whose only job is to remove
			// it. No ternary (house style): filter the empty part out
			// instead of choosing between two message shapes.
			const originalMessage = (error as Error).message;
			const parts = [STACK_MISSING_GUIDANCE, originalMessage];
			throw new Error(
				parts.filter((part) => part.length > 0).join("\n\nOriginal error:\n"),
			);
		}
		poolRef.current = pool;

		const driver = neonDriver(pool);
		await driver.execute({
			sql: "drop schema if exists app cascade",
			params: [],
			kind: "sql",
		});
		await driver.execute({
			sql: `do $$ begin
				if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
				if not exists (select from pg_roles where rolname = 'anonymous') then create role anonymous; end if;
			end $$`,
			params: [],
			kind: "sql",
		});
		await driver.execute({ sql: migrationSql, params: [], kind: "sql" });

		const handle = db(declarations, driver);
		await handle
			.insert(identityGated)
			.values([
				{ ownerId: OWNER_A },
				{ ownerId: OWNER_A },
				{ ownerId: OWNER_B },
			]);
		await handle.insert(roleGated).values([{ id: randomUUID() }]);
		const oneDayTwoHours = {
			years: 0,
			months: 0,
			days: 1,
			hours: 2,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		};
		await handle.insert(shapes).values({
			amount: 9007199254740991,
			precise: "123456789012345678901234.567890123456789",
			seenAt: new Date("2026-01-15T10:30:00Z"),
			tags: [1, 2, 3],
			duration: oneDayTwoHours,
			durations: [oneDayTwoHours, oneDayTwoHours],
			precisions: ["123.450000", "0.100000"],
		});
	}, 30_000);

	afterAll(async () => {
		await poolRef.current?.end();
	});

	it("connects through the local proxy", async () => {
		const driver = neonDriver(poolRef.current as Pool);
		const rows = await driver.execute({
			sql: "select 1 as one",
			params: [],
			kind: "sql",
		});
		expect(rows).toEqual([{ one: 1 }]);
	});

	it("the declared capabilities hold against a real server (task 7.3)", async () => {
		const pool = poolRef.current as Pool;
		const driver = neonDriver(pool);

		// An interactive transaction commits across round trips: two
		// statements on one held connection, the second reading what the
		// first just set, both inside the same transaction() callback.
		const insideTransaction = await driver.transaction(async (session) => {
			await session.execute({
				sql: "set local app.witness_local = 'inside'",
				params: [],
				kind: "sql",
			});
			const rows = await session.execute({
				sql: "select current_setting('app.witness_local', true) as v",
				params: [],
				kind: "sql",
			});
			return rows[0]?.v;
		});
		expect(insideTransaction).toBe("inside");

		// A transaction-local setting is gone after commit -- read on a
		// fresh (pool max:1, so the same physical) connection.
		const afterCommit = await driver.execute({
			sql: "select current_setting('app.witness_local', true) as v",
			params: [],
			kind: "sql",
		});
		expect(afterCommit[0]?.v).toBeFalsy();

		// A session setting survives to the next statement: two separate
		// (non-transactional) execute() calls, same reused connection.
		await driver.execute({
			sql: "set app.witness_session = 'persisted'",
			params: [],
			kind: "sql",
		});
		const sessionCheck = await driver.execute({
			sql: "select current_setting('app.witness_session', true) as v",
			params: [],
			kind: "sql",
		});
		expect(sessionCheck[0]?.v).toBe("persisted");
	});

	it("filters rows to the context's subject (task 7.4)", async () => {
		const driver = neonDriver(poolRef.current as Pool);
		const handle = db(declarations, driver);
		const context = neonAuth("claims").asUser({ sub: OWNER_A });

		const rows = await handle.as(context).execute(select(identityGated));

		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((row) => row.ownerId === OWNER_A)).toBe(true);
	});

	it("a role-keyed policy admits under a mismatched mode while an identity-keyed policy denies (task 7.5)", async () => {
		const driver = neonDriver(poolRef.current as Pool);
		// The local stack has no JWK configured, so it is in claims mode --
		// a context from the jwt-mode builder is therefore a genuine
		// mismatch, with no extra infrastructure needed to produce one.
		const mismatchedContext = neonAuth("jwt").asJwtUser("not-a-real-jwt");

		const identityHandle = db(declarations, driver);
		const identityRows = await identityHandle
			.as(mismatchedContext)
			.execute(select(identityGated));
		expect(identityRows).toEqual([]);

		const roleHandle = db(declarations, driver);
		const roleRows = await roleHandle
			.as(mismatchedContext)
			.execute(select(roleGated));
		expect(roleRows.length).toBeGreaterThan(0);
	});

	it("identity does not survive the scoped execution on a reused connection (task 7.6)", async () => {
		const pool = poolRef.current as Pool;
		const driver = neonDriver(pool);
		const handle = db(declarations, driver);
		const context = neonAuth("claims").asUser({ sub: OWNER_A });

		await handle.as(context).execute(select(identityGated));

		// pool max:1 -- this checkout reuses the exact same physical
		// connection the scoped execution just released.
		const client = await pool.connect();
		try {
			const result = await client.query(
				"select current_setting('request.jwt.claims', true) as claims, current_setting('role') as role",
			);
			expect(result.rows[0].claims).toBeFalsy();
			expect(result.rows[0].role).not.toBe("authenticated");
		} finally {
			client.release();
		}
	});

	it("rows arrive in the vanilla driver's shapes for numeric, int8, timestamptz, and arrays (task 7.7)", async () => {
		const driver = neonDriver(poolRef.current as Pool);
		const handle = db(declarations, driver);

		const rows = await handle.execute(select(shapes));

		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (row === undefined) {
			throw new Error("the seeded shapes row was never returned");
		}
		// bigint({mode:'number'}): a JS number, not a string.
		expect(row.amount).toBe(9007199254740991);
		// numeric({mode:'string'}): the exact decimal text, never
		// parseFloat'd -- the axis Neon's own bundled parser could lose.
		expect(row.precise).toBe("123456789012345678901234.567890123456789");
		// timestamptz(): a real Date instance.
		expect(row.seenAt).toBeInstanceOf(Date);
		expect((row.seenAt as Date).toISOString()).toBe("2026-01-15T10:30:00.000Z");
		// integer().array(): an array of numbers, element-wise parsed.
		expect(row.tags).toEqual([1, 2, 3]);
	});

	it("rows arrive in the vanilla driver's shapes for the three oid-overridden types too (task 7.8)", async () => {
		const driver = neonDriver(poolRef.current as Pool);
		const handle = db(declarations, driver);

		const rows = await handle.execute(select(shapes));

		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (row === undefined) {
			throw new Error("the seeded shapes row was never returned");
		}
		const oneDayTwoHours = {
			years: 0,
			months: 0,
			days: 1,
			hours: 2,
			minutes: 0,
			seconds: 0,
			microseconds: 0,
		};
		// interval() (oid 1186, the override's own raw-text passthrough):
		// a structured IntervalValue, never a client-parsed object neither
		// hejbro's conversion layer nor `pg-types` would recognize.
		expect(row.duration).toEqual(oneDayTwoHours);
		// interval[] (oid 1187): element-wise the same structured shape.
		expect(row.durations).toEqual([oneDayTwoHours, oneDayTwoHours]);
		// numeric[] (oid 1231): raw decimal text per element, never
		// already-`parseFloat`'d numbers -- exact scale/precision intact.
		expect(row.precisions).toEqual(["123.450000", "0.100000"]);
	});
});
