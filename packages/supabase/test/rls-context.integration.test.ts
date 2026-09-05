import { randomUUID } from "node:crypto";
import { eq, rls, schema, select, table, text, uuid } from "@hejbro/core";
import type { CompileResult, Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUidCached } from "../src/auth";
import { asAnon, asUser } from "../src/context";
import { supabaseDriver } from "../src/driver";

// Hard rule (lead, group 6 batch B): 6.4 adds no `src/` code -- the
// coverage gate's `include: ["src/**/*.ts"]` runs against the default
// `pnpm test`, which this file is excluded from (vitest.config.ts); code
// whose only coverage came from here would read as 0% and blow the CRAP
// budget. Everything below (connection detection, the DDL fixture, the
// hand-rolled Driver) lives in this test file on purpose.

/**
 * Task 6.0's own scout: the default local `supabase start` DB URL/port.
 * Overridable so CI or a differently-configured stack can point
 * elsewhere without editing this file.
 */
const SUPABASE_DB_URL =
	process.env.SUPABASE_DB_URL ??
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Task 6.4 is detect-and-guide, never start-the-stack (lead decision,
 * recorded in tasks.md 6.0): a down stack fails loudly here rather than
 * silently skipping or trying to launch Docker itself.
 */
const guidance = (cause: unknown): Error =>
	new Error(
		`Could not reach a local Supabase stack at ${SUPABASE_DB_URL}. Next: run "supabase start" from a supabase-initialized project directory. On colima, plain "supabase start" can fail -- the vector log-collector container tries to mount ~/.colima/default/docker.sock and colima's virtiofs rejects it (confirmed 2026-08-27); work around it with "supabase start -x vector" (exclude other unneeded services the same way). Set SUPABASE_DB_URL to point at a different stack.`,
		{ cause },
	);

/**
 * A minimal, hand-rolled contract `Driver` over a real `pg.Pool` --
 * never `@hejbro/pg` (task 6.2's own decorator boundary; `packages/pg`
 * doesn't even exist on this branch, group 5's own scope). No
 * IntervalStyle session pin or per-query type override: this fixture
 * carries no `interval`/moded-array columns (#320), so none of that
 * machinery is exercised here -- it is group 5's contract to own.
 */
const handRolledDriver = (pool: Pool): Driver => {
	const run = async (
		queryable: Pick<Pool, "query">,
		compiled: CompileResult,
	) => {
		const result = await queryable.query(compiled.sql, [...compiled.params]);
		return result.rows;
	};
	return {
		capabilities: {
			"interactive-transactions": true,
			"session-state": true,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: (compiled) => run(pool, compiled),
		transaction: async (callback) => {
			const client = await pool.connect();
			try {
				await client.query("begin");
				const session: DriverSession = {
					execute: (compiled) => run(client, compiled),
				};
				const result = await callback(session);
				await client.query("commit");
				return result;
			} catch (error) {
				await client.query("rollback");
				throw error;
			} finally {
				client.release();
			}
		},
		batch: async () => [],
		setupSession: async () => {},
	};
};

describe("vitest wiring self-check (task 6.4's own #131 alias, integration config inheritance)", () => {
	it("resolves @hejbro/core from source via the alias, not a stale/missing dist build (same proof as packages/query/test/scaffold.test.ts's task 1.1 precedent)", () => {
		expect(typeof eq).toBe("function");
		expect(typeof schema).toBe("function");
	});
});

describe("real-stack RLS integration (colima + supabase start)", () => {
	const fixtureSchema = "rls_fixture_g6";
	const ownerSub = randomUUID();
	const otherSub = randomUUID();

	const app = schema(fixtureSchema);
	const posts = table(
		app,
		"posts",
		{
			id: uuid().primaryKey(),
			owner: uuid().notNull(),
			body: text().notNull(),
		},
		(t) => ({
			rls: rls.enabled({
				ownRows: rls
					.policy("posts_own_rows")
					.for("select")
					.to("authenticated")
					.using(eq(t.owner, authUidCached())),
			}),
		}),
	);

	let pool: Pool;
	let driver: Driver;

	beforeAll(async () => {
		pool = new Pool({ connectionString: SUPABASE_DB_URL });
		try {
			await pool.query("select 1");
		} catch (cause) {
			// `afterAll` below still runs even when `beforeAll` throws (vitest
			// guarantees teardown) and owns the single `pool.end()` call --
			// ending it here too double-ends the same pool.
			throw guidance(cause);
		}

		await pool.query(`drop schema if exists "${fixtureSchema}" cascade`);
		await pool.query(`create schema "${fixtureSchema}"`);
		await pool.query(`
			create table "${fixtureSchema}"."posts" (
				id uuid primary key default gen_random_uuid(),
				owner uuid not null,
				body text not null
			)
		`);
		await pool.query(
			`alter table "${fixtureSchema}"."posts" enable row level security`,
		);
		await pool.query(`
			create policy "posts_own_rows" on "${fixtureSchema}"."posts"
				for select to authenticated
				using (owner = auth.uid())
		`);
		await pool.query(
			`grant usage on schema "${fixtureSchema}" to anon, authenticated`,
		);
		await pool.query(
			`grant select on "${fixtureSchema}"."posts" to anon, authenticated`,
		);
		await pool.query(
			`insert into "${fixtureSchema}"."posts" (owner, body) values ($1, $2), ($3, $4)`,
			[ownerSub, "owner-row", otherSub, "other-row"],
		);

		driver = handRolledDriver(pool);
	});

	afterAll(async () => {
		if (pool) {
			await pool
				.query(`drop schema if exists "${fixtureSchema}" cascade`)
				.catch(() => {});
			await pool.end();
		}
	});

	it("authUid() policy filters rows by claims subject through asUser", async () => {
		const handle = db({ posts }, supabaseDriver(driver));

		const rows = await handle
			.as(asUser({ sub: ownerSub }))
			.execute(select(posts));

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ owner: ownerSub, body: "owner-row" });
	});

	it("asAnon sees none -- granted select, no matching policy for anon", async () => {
		const handle = db({ posts }, supabaseDriver(driver));

		const rows = await handle.as(asAnon()).execute(select(posts));

		expect(rows).toHaveLength(0);
	});
});
