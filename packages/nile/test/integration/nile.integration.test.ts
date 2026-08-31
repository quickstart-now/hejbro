import { execFileSync } from "node:child_process";
import { schema, table, uuid } from "@hejbro/core";
import { pgDriver } from "@hejbro/pg";
import { db } from "@hejbro/query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asTenant } from "../../src/context";
import { nileDriver } from "../../src/driver";

/**
 * Docker-gated live witness against Nile's own official testing container
 * (task 5.1-5.6, #567, proposal.md's "Measurement protocol", Rule 50) --
 * never runs under the default `pnpm test`/CI (excluded by
 * `vitest.config.ts`'s own pattern, picked up only by
 * `vitest.integration.config.ts`'s `include`). Local-only:
 * `pnpm --filter @hejbro/nile test:integration`.
 *
 * Two obligations #553 placed on a contributing driver are already
 * verified against stubs in this package's own unit suite (context.test.ts,
 * driver.test.ts): a rendering that interpolates owns the safety of what
 * it interpolates (3.5/3.6), and its statements leave nothing behind on
 * the connection (3.4's SET LOCAL form). This file is not a second proof
 * of either -- it is the **server-side corroboration** proposal.md's "The
 * live witness, and what it is not" section calls for: what the server
 * actually *does* with the rendering's own statements, which a stub can
 * never show.
 *
 * The image is pinned by full digest (task 5.2) -- PostgreSQL 15.12, built
 * 2025-05-20 (`docker inspect`'s own `Config.Env` PG_VERSION, and the
 * image's `org.opencontainers.image.created` label). Measurement command:
 * `docker pull ghcr.io/niledatabase/testingcontainer@sha256:188a7230d9f39e615bc584d90e8ec6f4754d0ef298701a1d6811d394f3d35696`.
 * Every claim below is a floor, not a ceiling: the platform may have
 * widened since this digest was measured (2026-08-31) -- if the digest
 * ever changes, re-measure every scenario in this file, don't assume the
 * old answers still hold. Overriding the image means the run no longer
 * measures the digest this file names; the measured-on-digest claims do
 * not transfer to that run.
 */
const IMAGE =
	process.env.HEJBRO_NILE_IMAGE ??
	"ghcr.io/niledatabase/testingcontainer@sha256:188a7230d9f39e615bc584d90e8ec6f4754d0ef298701a1d6811d394f3d35696";
const CONTAINER = `hejbro-nile-integration-${process.pid}`;

/**
 * The container's own fixed credentials for its one pre-provisioned
 * database (measured 2026-08-31 via `docker logs` on first boot -- the
 * image's `startup` process always creates database "test" under
 * developer id `00000000-0000-0000-0000-000000000000`, password
 * "password"; neither is configurable through an env var the image
 * documents, so these are the image's own fixed values, not a convention
 * this file invented).
 */
const NILE_USER = "00000000-0000-0000-0000-000000000000";
const NILE_PASSWORD = "password";
const NILE_DATABASE = "test";

/** `true` iff a Docker daemon actually answers -- mirrors `packages/pg/test/integration.test.ts`'s own guard. */
const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

/** The host port Docker mapped container port 5432 to -- same parsing rule as `packages/pg`'s own `discoverHostPort` (only the first line of `docker port`'s output is used; both address families map to the same host port). */
const discoverHostPort = (): number => {
	const output = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], {
		encoding: "utf8",
	});
	const firstLine = output.trim().split("\n")[0];
	const lastColon = firstLine?.lastIndexOf(":");
	if (firstLine === undefined || lastColon === undefined || lastColon === -1) {
		throw new Error(
			`could not parse the host port docker mapped for container "${CONTAINER}" from: ${JSON.stringify(output)}`,
		);
	}
	return Number(firstLine.slice(lastColon + 1));
};

/**
 * Polls the *target database* itself, not `pg_isready` -- measured
 * 2026-08-31: `postgres` starts accepting TCP connections almost
 * immediately, but the "test" database is provisioned asynchronously by
 * the image's own `startup`/`khnum` control-plane exchange (its first
 * attempt reliably fails with "connection refused" before khnum's own
 * REST server is up; supervisord retries it, and the whole exchange
 * takes several seconds). A `pg_isready`-style check would report ready
 * during exactly the window where connecting to "test" itself still
 * fails -- the same cold-start-flake shape `packages/pg`'s own harness
 * documents for a different reason.
 */
const waitUntilReady = async (
	connectionString: string,
	maxAttempts = 30,
): Promise<void> => {
	const attempt = async (remaining: number): Promise<void> => {
		const driver = pgDriver(connectionString);
		try {
			await driver.execute({ sql: "select 1", params: [], kind: "sql" });
			await driver.client.end();
			return;
		} catch (error) {
			await driver.client.end();
			if (remaining <= 0) {
				throw new Error(
					`the "${NILE_DATABASE}" database in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`. Last error: ${(error as Error).message}`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
			return attempt(remaining - 1);
		}
	};
	await attempt(maxAttempts);
};

const app = schema("app");

/**
 * A tenant-aware table, built with **raw DDL**, never through
 * `generateMigration` -- measured 2026-08-31: Nile requires the
 * `tenant_id` column to be part of the primary key on any table that
 * carries one at all (`create table` with `tenant_id uuid, id uuid
 * primary key` fails with "primary key of tenant-aware table must have
 * the tenant_id column"; a composite `primary key (id, tenant_id)`
 * succeeds). Core's `table()` DSL **can** express a composite primary key
 * (`.primaryKey()` on more than one column collects into one
 * `constraint "..." primary key (...)` clause, confirmed by generating
 * this exact shape) -- corrected after an earlier, wrong claim to the
 * contrary in this file. Raw DDL is still used here for the same reason
 * `packages/pg`/`packages/neon`'s own witnesses use it: schema/table
 * setup is out of this group's scope, never through `db()`. This table
 * is declared only for its typed `db()` handle (`widgets.id`/
 * `widgets.tenantId`).
 */
const widgets = table(app, "widgets", {
	id: uuid().notNull(),
	tenantId: uuid().notNull(),
});

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
/** Syntactically valid, deliberately never registered in the `tenants` table (task 5.4's own "names no tenant" value). */
const UNREGISTERED_TENANT = "99999999-9999-9999-9999-999999999999";

describe("nileDriver + a real db() handle against Nile's official testing container (task 5.1-5.6, #567)", () => {
	const containerStarted: { current: boolean } = { current: false };
	// One shared pool for the whole describe block (mirrors
	// `packages/pg`/`packages/neon`'s own integration harness) -- a fresh
	// `pgDriver(...)` per test would each open and never close its own
	// `Pool`, which then throws an unhandled "Connection terminated
	// unexpectedly" once `afterAll` removes the container out from under
	// it (observed 2026-08-31: 3 such errors before this refactor, tests
	// still all green -- but a leaked-connection error the suite doesn't
	// own is exactly the kind of noise this file must not produce).
	const base: { current: ReturnType<typeof pgDriver> | undefined } = {
		current: undefined,
	};
	const driver: { current: ReturnType<typeof nileDriver> | undefined } = {
		current: undefined,
	};

	beforeAll(async () => {
		if (!dockerAvailable()) {
			throw new Error(
				"packages/nile's integration suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter @hejbro/nile test:integration`.",
			);
		}
		execFileSync("docker", ["run", "-d", "--name", CONTAINER, "-P", IMAGE]);
		containerStarted.current = true;
		const port = discoverHostPort();
		const built = `postgres://${NILE_USER}:${NILE_PASSWORD}@localhost:${port}/${NILE_DATABASE}`;
		await waitUntilReady(built);
		base.current = pgDriver(built);
		driver.current = nileDriver(base.current);

		// tenants must be registered in the platform's own `tenants` table
		// before SET LOCAL nile.tenant_id will admit them (task 5.4's own
		// pre-registration) -- measured: an unregistered but well-formed
		// UUID is refused server-side (asserted below, not assumed). Two
		// separate statements, never a multi-row VALUES list: measured
		// 2026-08-31 that a single statement naming more than one distinct
		// tenant id is refused ("cannot set tenant_id more than once") --
		// the platform reads an insert into this table as itself an
		// implicit tenant-context operation, one tenant per statement, the
		// same constraint `widgets` (an ordinary tenant-aware table) is
		// under.
		await base.current.execute({
			sql: "insert into tenants (id, name) values ($1, 'tenant-a')",
			params: [TENANT_A],
			kind: "sql",
		});
		await base.current.execute({
			sql: "insert into tenants (id, name) values ($1, 'tenant-b')",
			params: [TENANT_B],
			kind: "sql",
		});
		await base.current.execute({
			sql: 'create schema if not exists "app"',
			params: [],
			kind: "sql",
		});
		await base.current.execute({
			sql: 'create table "app"."widgets" (id uuid not null, tenant_id uuid not null, primary key (id, tenant_id))',
			params: [],
			kind: "sql",
		});
	}, 60_000);

	afterAll(async () => {
		await base.current?.client.end();
		if (containerStarted.current) {
			execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
		}
	});

	it("connects through nileDriver against the real container", async () => {
		const rows = await (
			driver.current as ReturnType<typeof nileDriver>
		).execute({
			sql: "select 1 as one",
			params: [],
			kind: "sql",
		});
		expect(rows).toEqual([{ one: 1 }]);
	});

	it("witness A: an adversarial tenant value is refused by our own UUID check, and a syntactically valid but unregistered UUID is refused by the server (task 5.4, pre-registered outcome)", async () => {
		const handle = db(
			{ widgets },
			driver.current as ReturnType<typeof nileDriver>,
		);

		// our own half (already unit-asserted in context.test.ts, task 3.5)
		// -- restated here as the "our own UUID check" half of the witness,
		// against the real decorated driver rather than a stub.
		await expect(
			handle.as(asTenant("'; drop table widgets; --")).select(widgets),
		).rejects.toMatchObject({ code: "nile-context-value-invalid" });

		// pre-registered outcome: the server refuses an unregistered tenant
		// (measured 2026-08-31, "tenant ... not found") -- not the other
		// outcome (accepted with an empty scope). Whichever it is, the claim
		// under test is that a value we did not intend cannot silently
		// widen the scope; here it does not even reach a scoped read.
		await expect(
			handle.as(asTenant(UNREGISTERED_TENANT)).select(widgets),
		).rejects.toThrow(/tenant .* not found/i);
	});

	it("witness B: after a context transaction, the next transaction on the same connection does not observe the previous tenant", async () => {
		const handle = db(
			{ widgets },
			driver.current as ReturnType<typeof nileDriver>,
		);

		// captured before the scoped read, so the D106 F11 pid check below
		// has a real baseline -- not an assumption about pool behavior.
		const beforePid = await (
			base.current as ReturnType<typeof pgDriver>
		).execute({
			sql: "select pg_backend_pid() as pid",
			params: [],
			kind: "sql",
		});

		await handle.as(asTenant(TENANT_A)).select(widgets);

		// pool max is node-postgres's own default (>1) elsewhere, but this
		// pool never received a size option -- observed 2026-08-31: the very
		// next `execute()` reuses the same backend the scoped read just
		// released (Nile's own container has no other traffic contending
		// for the pool). A raw, uncontexted read right after the scoped one
		// is the server-side half of "leaves nothing behind": if the
		// tenant setting had survived, this select would 500 with the same
		// "tenant ... not found"/permission story the scoped path uses,
		// not succeed.
		const rows = await (base.current as ReturnType<typeof pgDriver>).execute({
			sql: "select current_setting('nile.tenant_id', true) as v, pg_backend_pid() as pid",
			params: [],
			kind: "sql",
		});
		expect(rows[0]?.v).toBeFalsy();
		// D106 F11: without this, "no tenant survives" would be trivially
		// true for the wrong reason if the pool had silently opened a
		// second physical connection between the two reads -- a different
		// backend was never going to see the first one's SET LOCAL either
		// way, which would prove nothing about the setting's own
		// transaction-local scope. Same backend pid confirms it's actually
		// the setting expiring, not a connection swap.
		expect(rows[0]?.pid).toBe(beforePid[0]?.pid);
	});

	it("witness C: rows are actually scoped to the tenant our rendering applied (task 5.6, cheap given the fixtures above)", async () => {
		const handle = db(
			{ widgets },
			driver.current as ReturnType<typeof nileDriver>,
		);

		const idA1 = "aaaaaaaa-0000-4000-8000-000000000001";
		const idA2 = "aaaaaaaa-0000-4000-8000-000000000002";
		const idB1 = "bbbbbbbb-0000-4000-8000-000000000001";
		await handle
			.as(asTenant(TENANT_A))
			.insert(widgets)
			.values([{ id: idA1, tenantId: TENANT_A }]);
		await handle
			.as(asTenant(TENANT_A))
			.insert(widgets)
			.values([{ id: idA2, tenantId: TENANT_A }]);
		await handle
			.as(asTenant(TENANT_B))
			.insert(widgets)
			.values([{ id: idB1, tenantId: TENANT_B }]);

		const rowsForA = await handle.as(asTenant(TENANT_A)).select(widgets);
		expect(rowsForA.map((row) => row.id).sort()).toEqual([idA1, idA2].sort());

		const rowsForB = await handle.as(asTenant(TENANT_B)).select(widgets);
		expect(rowsForB.map((row) => row.id)).toEqual([idB1]);
	});
});
