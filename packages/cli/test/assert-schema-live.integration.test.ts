import { execFileSync } from "node:child_process";
import {
	emptySnapshot,
	generateMigration,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { pgDriver } from "@hejbro/pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AssertSchemaHandle } from "../src/assert-schema";
import { assertSchema } from "../src/assert-schema";

/**
 * The other half of group 2's own fixture pin (owner decision ⑤, mirrors
 * `check-live.integration.test.ts`'s own top comment): every unit test in
 * this change ran `assertSchema` against a *canned* catalog -- a fixture
 * session answering `readCatalog`'s 15 queries from an in-memory table,
 * never a real `pg_catalog`. This file is the only place `assertSchema`
 * runs its real `readCatalog` path (through `@hejbro/pg`'s own driver)
 * against a real postgres:17, proving the query shapes those unit tests
 * fixed actually match what a live catalog answers. Never runs under the
 * default `pnpm test`/CI (wired via `vitest.integration.config.ts`) --
 * local-only, `pnpm --filter hejbro test:integration`. Docker-gated:
 * `beforeAll` fails loudly (never a silent skip) when no daemon answers,
 * the same idiom `check-live.integration.test.ts`/`packages/pg`'s own
 * integration suite use.
 *
 * The Docker harness below (container lifecycle, readiness poll, port
 * discovery, `psql` exec) is a third independent copy of the same
 * boilerplate `packages/pg/test/integration.test.ts` and
 * `check-live.integration.test.ts` each already carry — mirrored, never
 * imported: none of the three is exported, and there is no shared
 * test-support module for it, so each integration file owns its own
 * setup. `readyLogLineCount`'s wait for the *second* "ready" log line is
 * the one non-obvious piece: the official postgres image's entrypoint
 * runs a temporary bootstrap server before the real one, and a
 * single-match readiness probe can pass against that bootstrap window
 * and then race its shutdown — reinventing this without that detail
 * reproduces the flake `check-live.integration.test.ts` already fixed.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `hejbro-cli-assert-schema-${process.pid}`;

const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((doResolve) => setTimeout(doResolve, ms));

/**
 * Waits for the *second* "database system is ready to accept
 * connections" log line -- the official postgres image's entrypoint runs
 * a temporary bootstrap server first, then the real one; a single-match
 * probe can pass against the bootstrap window and race the restart.
 * Mirrors `check-live.integration.test.ts`'s own `readyLogLineCount`/
 * `waitUntilReady`, measured there at 9/9 clean runs after this exact
 * fix.
 */
const readyLogLineCount = (): number => {
	const logs = execFileSync("sh", ["-c", `docker logs ${CONTAINER} 2>&1`], {
		encoding: "utf-8",
	});
	return (logs.match(/database system is ready to accept connections/g) ?? [])
		.length;
};

const waitUntilReady = async (attemptsLeft: number): Promise<void> => {
	if (readyLogLineCount() >= 2) {
		return;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`postgres in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`.`,
		);
	}
	await sleep(300);
	return waitUntilReady(attemptsLeft - 1);
};

/** `docker port` prints one line per bound address family -- the first line's trailing `host:port` is enough (mirrors `check-live.integration.test.ts`'s own `containerPort`). */
const containerPort = (): string => {
	const output = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], {
		encoding: "utf-8",
	});
	const firstLine = (output.trim().split("\n")[0] ?? "").trim();
	const port = firstLine.split(":").at(-1);
	if (port === undefined || port === "") {
		throw new Error(
			`could not parse the host port docker mapped for container "${CONTAINER}" from: ${JSON.stringify(output)}`,
		);
	}
	return port;
};

const psqlCommand = (database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-d",
			database,
			"-c",
			sql,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
};

const psqlFile = (database: string, sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			"-i",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
			"-d",
			database,
		],
		{ input: sql, stdio: ["pipe", "ignore", "inherit"] },
	);
};

let hostPort = "";

const dbUrl = (database: string): string =>
	`postgres://postgres@127.0.0.1:${hostPort}/${database}`;

/**
 * The one declared table this file asserts against -- a real table with
 * a primary key and a `not null` column, applied to a fresh database via
 * `generateMigration`'s own SQL (never hand-written DDL), so the
 * declaration and the database it is asserted against both trace back to
 * the same declared source.
 */
const liveSchema = schema("live_assert");
const widgets = table(liveSchema, "widgets", {
	id: uuid().primaryKey(),
	label: text().notNull(),
});

beforeAll(async () => {
	if (!dockerAvailable()) {
		throw new Error(
			"packages/cli's assert-schema live-witness suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter hejbro test:integration`.",
		);
	}
	execFileSync(
		"docker",
		[
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-e",
			"POSTGRES_PASSWORD=postgres",
			"-e",
			"POSTGRES_HOST_AUTH_METHOD=trust",
			"-p",
			"127.0.0.1::5432",
			IMAGE,
		],
		{ stdio: "ignore" },
	);
	await waitUntilReady(60);
	hostPort = containerPort();

	psqlCommand("postgres", "create database live_assert;");
	const migration = generateMigration({
		declarations: [liveSchema, widgets],
		previousSnapshot: emptySnapshot,
	});
	expect(migration.errors).toEqual([]);
	psqlFile("live_assert", migration.sql);
}, 120_000);

afterAll(() => {
	execFileSync("docker", ["rm", "-f", "-v", CONTAINER], { stdio: "ignore" });
});

describe("assertSchema / live witness (group 3, task 3.1)", () => {
	it("passes against a database built from the declarations, and real comparison actually happened", async () => {
		const driver = pgDriver(dbUrl("live_assert"));
		try {
			const handle: AssertSchemaHandle = { schema: { widgets }, driver };
			const report = await assertSchema(handle);

			// Not just "did not throw" -- a run whose compared set is empty
			// would also resolve without throwing (group 2's own cause-ⓒ-only
			// scenario), which would make this witness pass for the wrong
			// reason. Non-empty `compared`, naming this exact table, is the
			// evidence a real comparison ran against the real catalog.
			expect(report.compared).toEqual([{ identity: "live_assert.widgets" }]);
			expect(report.notCompared).toEqual([]);
		} finally {
			await driver.client.end();
		}
	});

	it("throws naming the object once it is dropped directly in the database", async () => {
		psqlCommand("live_assert", "drop table live_assert.widgets;");
		const driver = pgDriver(dbUrl("live_assert"));
		try {
			const handle: AssertSchemaHandle = { schema: { widgets }, driver };

			expect.assertions(3);
			try {
				await assertSchema(handle);
			} catch (error) {
				expect((error as { readonly code?: unknown }).code).toBe(
					"assert-schema-diverged",
				);
				expect((error as { readonly message?: unknown }).message).toContain(
					"live_assert.widgets",
				);
				// Group 3 follow-up (review finding): the umbrella code alone
				// doesn't prove the per-object finding travels intact -- this
				// was previously only visible in a diagnostic dump quoted in a
				// report, never asserted.
				expect(
					(
						error as {
							readonly findings?: ReadonlyArray<{
								readonly error: { readonly code: string };
							}>;
						}
					).findings?.[0]?.error.code,
				).toBe("check-object-missing");
			}
		} finally {
			await driver.client.end();
			// No recreation: this is the last test in the file, and the
			// container itself is torn down in `afterAll` regardless.
		}
	});
});
