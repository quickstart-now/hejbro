import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pgDriver } from "@hejbro/pg";
import { db } from "hejbro";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { members, projects, tasks } from "../src/app.schema";
import { projectTaskReport } from "../src/reporting.query";

/**
 * Docker-gated: the reporting query (#474 3.2) executed for real against a
 * live postgres:17, not just compiled — the "actually executes" half of
 * #474's own finding ("no db(, no pgDriver ... anywhere in examples").
 * Never runs under the default `pnpm test`/CI (`vitest.integration.
 * config.ts` + the matching exclude in `vitest.config.ts`, mirroring
 * `packages/pg`'s own integration suite convention) — local-only,
 * `pnpm --filter example-postgres test:integration`. Rides alongside the
 * existing `roundtrip` script (Docker, local-only) rather than beside it:
 * `roundtrip.sh` tears its own container down on exit, so this suite
 * manages its own, the same way `packages/pg/test/integration.test.ts`
 * does, rather than reaching into a container that would already be gone.
 *
 * Schema setup applies the example's own committed migration chain
 * (`seed/roles.sql` then `migrations/*.sql`, in order) via `psql` inside
 * the container — the same two-step `roundtrip.sh` itself performs for
 * its own "chain" database — so this suite proves the query layer against
 * the exact DDL a real user's `hejbro generate` produced, never
 * hand-written DDL that could drift from it.
 */
const IMAGE = process.env.HEJBRO_PG_IMAGE ?? "postgres:17-alpine";
const CONTAINER = `example-postgres-integration-${process.pid}`;
const DATABASE = "reporting";

/**
 * #709: `docker rm -f <container>` (no `-v`) freed the container but
 * left the official `postgres` image's own declared data volume
 * behind as an orphaned anonymous volume -- every integration
 * witness's own `afterAll` did this, and the accumulation (1,418
 * volumes, 84 GB) ate the shared Docker data disk (round 4, D106).
 * `-v` frees the volume too; this checks that it actually happened,
 * since the flag's own success is silent -- the volume names this
 * container's own mounts carried, read before removal, must all be
 * gone from `docker volume ls` right after. Naming both the leftover
 * volumes and the container on failure is half this check's value.
 * Not shared with the sibling copies in `packages/cli/test/
 * docker-volumes.ts`/`packages/pg/test/docker-volumes.ts` -- a single
 * call site here has no reason to add a cross-package dependency.
 */
const removeContainer = (container: string): void => {
	const mounted = execFileSync(
		"docker",
		["inspect", "--format", "{{range .Mounts}}{{.Name}} {{end}}", container],
		{ encoding: "utf-8" },
	)
		.trim()
		.split(/\s+/)
		.filter((name) => name.length > 0);
	execFileSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore" });
	if (mounted.length === 0) {
		return;
	}
	const remaining = new Set(
		execFileSync("docker", ["volume", "ls", "-q"], { encoding: "utf-8" })
			.split("\n")
			.filter((name) => name.length > 0),
	);
	const stillPresent = mounted.filter((name) => remaining.has(name));
	if (stillPresent.length === 0) {
		return;
	}
	throw new Error(
		`docker rm -f -v "${container}" did not remove its own volume(s): ${stillPresent.join(", ")}. Next: check \`docker volume rm ${stillPresent.join(" ")}\` by hand.`,
	);
};

const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const sleepSync = (seconds: number): void => {
	execFileSync("sleep", [String(seconds)]);
};

const waitUntilReady = (maxAttempts = 30): void => {
	const isReady = (): boolean => {
		try {
			execFileSync(
				"docker",
				[
					"exec",
					CONTAINER,
					"pg_isready",
					"-h",
					"127.0.0.1",
					"-U",
					"postgres",
					"-q",
				],
				{ stdio: "ignore" },
			);
			return true;
		} catch {
			return false;
		}
	};
	const attempt = (remaining: number): void => {
		if (isReady()) {
			return;
		}
		if (remaining <= 0) {
			throw new Error(
				`postgres in container "${CONTAINER}" never became ready. Next: check \`docker logs ${CONTAINER}\`.`,
			);
		}
		sleepSync(1);
		attempt(remaining - 1);
	};
	attempt(maxAttempts);
};

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

/** Pipes `sql` into `psql -d DATABASE` inside the container — the same shape `scripts/roundtrip.sh`'s own `psql()` helper uses. */
const applySql = (sql: string): void => {
	execFileSync(
		"docker",
		[
			"exec",
			"-i",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-d",
			DATABASE,
			"-v",
			"ON_ERROR_STOP=1",
			"-q",
		],
		{ input: sql, stdio: ["pipe", "ignore", "inherit"] },
	);
};

describe("the reporting query executed for real against postgres:17 (#474 3.3)", () => {
	const pool: { current: Pool | undefined } = { current: undefined };
	const containerStarted: { current: boolean } = { current: false };

	beforeAll(async () => {
		if (!dockerAvailable()) {
			throw new Error(
				"example-postgres's integration suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter example-postgres test:integration`.",
			);
		}
		execFileSync("docker", [
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-e",
			"POSTGRES_PASSWORD=postgres",
			"-P",
			IMAGE,
		]);
		containerStarted.current = true;
		waitUntilReady();
		const port = discoverHostPort();

		execFileSync("docker", [
			"exec",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-c",
			`create database ${DATABASE};`,
		]);

		const root = join(import.meta.dirname, "..");
		applySql(readFileSync(join(root, "seed/roles.sql"), "utf8"));
		const migrationFiles = readdirSync(join(root, "migrations"))
			.filter((name) => name.endsWith(".sql"))
			.sort();
		migrationFiles.forEach((name) => {
			applySql(readFileSync(join(root, "migrations", name), "utf8"));
		});

		pool.current = new Pool({
			host: "localhost",
			port,
			user: "postgres",
			password: "postgres",
			database: DATABASE,
		});
	}, 60_000);

	afterAll(async () => {
		await pool.current?.end();
		if (containerStarted.current) {
			removeContainer(CONTAINER);
		}
	});

	it("runs the join + aggregate + window report and returns the seeded, ranked rows", async () => {
		const activePool = pool.current;
		if (activePool === undefined) {
			throw new Error("beforeAll did not set up the pool");
		}
		const driver = pgDriver(activePool);
		const handle = db({ members, projects, tasks }, driver);

		const aliceId = "aaaaaaaa-0000-4000-8000-000000000001";
		const bobId = "aaaaaaaa-0000-4000-8000-000000000002";
		await handle.insert(members).values([
			{ id: aliceId, email: "alice@example.com", displayName: "Alice" },
			{ id: bobId, email: "bob@example.com", displayName: "Bob" },
		]);

		const apolloId = "bbbbbbbb-0000-4000-8000-000000000001";
		const boreasId = "bbbbbbbb-0000-4000-8000-000000000002";
		const ceresId = "bbbbbbbb-0000-4000-8000-000000000003";
		await handle.insert(projects).values([
			{ id: apolloId, slug: "apollo", name: "Apollo", ownerId: aliceId },
			{ id: boreasId, slug: "boreas", name: "Boreas", ownerId: bobId },
			{ id: ceresId, slug: "ceres", name: "Ceres", ownerId: aliceId },
		]);

		await handle.insert(tasks).values([
			{ projectId: apolloId, title: "Design the launch window" },
			{ projectId: apolloId, title: "Fuel the rocket" },
			{ projectId: apolloId, title: "Count down" },
			{ projectId: boreasId, title: "Chart the wind" },
			// Ceres gets no tasks -- proves the leftJoin keeps it in the report.
		]);

		const rows = await handle.execute(projectTaskReport);
		const byName = new Map(rows.map((row) => [row.projectName, row]));

		expect(rows).toHaveLength(3);
		expect(byName.get("Apollo")).toMatchObject({
			ownerName: "Alice",
			taskCount: 3n,
			taskCountRank: 1n,
		});
		expect(byName.get("Boreas")).toMatchObject({
			ownerName: "Bob",
			taskCount: 1n,
			taskCountRank: 2n,
		});
		expect(byName.get("Ceres")).toMatchObject({
			ownerName: "Alice",
			taskCount: 0n,
			taskCountRank: 3n,
		});
	});
});
