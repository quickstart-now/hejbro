import type { ExecException } from "node:child_process";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

/**
 * The live half of `vendored-contract.test.ts`'s own claim (#587 3.2):
 * that file's real-`tsc` smoke proves the vendored `fn`'s TYPES agree
 * with the local declaration path; this file proves the CALLS actually
 * work — a real server, a real insert, a real function call, real rows
 * back. Never runs under the default `pnpm test`/CI (Docker-gated,
 * local-only: `pnpm --filter cli-smoke test:integration`), mirroring
 * `examples/postgres/test/integration.test.ts` and `packages/cli/test/
 * apply-live.integration.test.ts`'s own idiom.
 *
 * **Two images, not one** (PG15, the declared floor, and PG17), same
 * reasoning `apply-live.integration.test.ts` gives: a supported version
 * with no witness is a promise about a version nobody ran.
 *
 * The live call itself runs in a **spawned `node` process**, not
 * in-process in this vitest file — the generated `contract.ts` and this
 * suite's own live-check script both resolve `"hejbro"`/`"@hejbro/pg"`
 * from the consumer fixture's own `node_modules` (real symlinks into the
 * built packages, the same mechanism `linkHejbro` already established for
 * the type-check half), never through vitest's own module graph. Node's
 * built-in TypeScript type-stripping (stable by this repo's own Node
 * floor) runs the live-check script's `.ts` source directly — no `tsx`/
 * `ts-node` devDependency needed.
 */
const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const PG_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "pg");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");

const require = createRequire(import.meta.url);

const assertBuiltPackages = (): void => {
	if (!existsSync(CLI_PATH)) {
		throw new Error(
			`built CLI artifact missing: ${CLI_PATH} -- run pnpm build (turbo should have built hejbro before its tests)`,
		);
	}
	const pgDist = join(PG_PACKAGE_ROOT, "dist", "index.js");
	if (!existsSync(pgDist)) {
		throw new Error(
			`built @hejbro/pg artifact missing: ${pgDist} -- run pnpm build (turbo should have built @hejbro/pg before its tests)`,
		);
	}
};

const dockerAvailable = (): boolean => {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

type ExecResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

const run = (
	command: string,
	args: ReadonlyArray<string>,
	cwd: string,
): Promise<ExecResult> =>
	new Promise((resolve) => {
		execFile(command, args, { cwd }, (error, stdout, stderr) => {
			if (error === null) {
				resolve({ exitCode: 0, stdout, stderr });
				return;
			}
			resolve({ exitCode: exitCodeFrom(error), stdout, stderr });
		});
	});

const runCli = (
	cwd: string,
	args: ReadonlyArray<string>,
): Promise<ExecResult> => run(process.execPath, [CLI_PATH, ...args], cwd);

/** Symlinks `packageDir` into `cwd/node_modules/<name>` — the same mechanism `vendored-contract.test.ts`'s own `linkHejbro` uses, generalized to any package this suite's live-check script needs to resolve. `name` may be scoped (`"@hejbro/pg"`), so the target's own parent directory (`node_modules/@hejbro`, not just `node_modules`) has to exist before the symlink call, or `symlink()` fails `ENOENT` on the scope directory itself. */
const linkPackage = async (
	cwd: string,
	name: string,
	packageDir: string,
): Promise<void> => {
	const target = join(cwd, "node_modules", name);
	await mkdir(dirname(target), { recursive: true });
	await symlink(packageDir, target, "dir");
};

const linkRuntimeDependencies = async (cwd: string): Promise<void> => {
	await linkPackage(cwd, "hejbro", CLI_PACKAGE_ROOT);
	await linkPackage(cwd, "@hejbro/pg", PG_PACKAGE_ROOT);
	// `@hejbro/pg` declares `pg` as a peer dependency (its own
	// package.json), so the consumer -- this fixture -- has to supply it,
	// same as any real consumer would from its own dependency tree.
	// Resolved via `pg/package.json` (the package root, not `pg`'s own
	// entry file) so this never hardcodes a pnpm store layout.
	const pgPackageRoot = dirname(require.resolve("pg/package.json"));
	await linkPackage(cwd, "pg", pgPackageRoot);
};

const SCHEMA_SOURCE = `import { bigint, defineFunction, schema, select, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const totalPosts = defineFunction(
	app,
	"total_posts",
	{ args: { minWeight: bigint({ mode: "number" }) }, returns: bigint() },
	(ctx) => {
		ctx.return(sql\`1\`);
	},
);

export const postById = defineFunction(
	app,
	"post_by_id",
	{ args: { postId: uuid() }, returns: posts },
	(ctx, args) => {
		ctx.return(select(posts).where(sql\`\${posts.id} = \${args.postId}\`));
	},
);
`;

/**
 * The live-check script this suite writes into the consumer fixture and
 * spawns with plain `node` (#587 3.2) -- a scalar call (`totalPosts`,
 * ignoring its own arg, always returns 1 per its body) and a
 * table-returning call (`postById`), both against a row seeded moments
 * earlier by the same real driver.
 *
 * The seed row goes in via a **raw, parameterized insert directly on the
 * driver**, not the vendored client's own `.insert()` -- a real,
 * already-documented limitation this live run independently confirmed
 * (`@hejbro/query`'s `chain.ts`, `ChainApi["insert"]`'s own doc comment:
 * awaiting without `.returning()` "resolves exactly like `db.execute`...
 * empty rows, no RETURNING clause sent"; `buildTableClient`'s own
 * `insert` never calls it either). `packages/cli/test/two-repo.
 * integration.test.ts` hit the exact same wall first and settled on this
 * same workaround -- mirrored here rather than rediscovered blind.
 * Prints one JSON line so the test process can assert on it without
 * parsing anything the CLI itself wasn't meant to produce.
 */
const LIVE_CHECK_SOURCE = `import { randomUUID } from "node:crypto";
import { pgDriver } from "@hejbro/pg";
import { createDb } from "./.hejbro/vendor/contract.ts";

const url = process.argv[2];
if (url === undefined) {
	throw new Error("live-check.ts: missing database URL argument");
}

const driver = pgDriver(url);
const db = createDb(driver);

const postId = randomUUID();
const postTitle = "hello from live-check";
await driver.execute({
	sql: 'insert into "app"."posts" ("id", "title") values ($1, $2)',
	params: [postId, postTitle],
	kind: "sql",
});

const total = await db.fn.totalPosts({ minWeight: 5 });
const page = await db.fn.postById({ postId });

await driver.client.end();

console.log(
	JSON.stringify({
		insertedId: postId,
		insertedTitle: postTitle,
		total: total.toString(),
		page,
	}),
);
`;

const PG_IMAGES = ["postgres:15-alpine", "postgres:17-alpine"] as const;

const sleep = (ms: number): Promise<void> =>
	new Promise((doResolve) => setTimeout(doResolve, ms));

/** Same two-occurrence wait `apply-live.integration.test.ts` measured and fixed (#361-class scar this file inherits rather than re-discovers). */
const readyLogLineCount = (container: string): number => {
	const logs = execFileSync("sh", ["-c", `docker logs ${container} 2>&1`], {
		encoding: "utf-8",
	});
	return (logs.match(/database system is ready to accept connections/g) ?? [])
		.length;
};

const waitUntilReady = async (
	container: string,
	attemptsLeft: number,
): Promise<void> => {
	if (readyLogLineCount(container) >= 2) {
		return;
	}
	if (attemptsLeft <= 0) {
		throw new Error(
			`postgres in container "${container}" never became ready. Next: check \`docker logs ${container}\`.`,
		);
	}
	await sleep(300);
	return waitUntilReady(container, attemptsLeft - 1);
};

const containerPort = (container: string): string => {
	const output = execFileSync("docker", ["port", container, "5432/tcp"], {
		encoding: "utf-8",
	});
	const firstLine = (output.trim().split("\n")[0] ?? "").trim();
	const port = firstLine.split(":").at(-1);
	if (port === undefined || port === "") {
		throw new Error(
			`could not parse the host port docker mapped for container "${container}" from: ${JSON.stringify(output)}`,
		);
	}
	return port;
};

describe.each(PG_IMAGES)("vendored fn live witness / %s", (image) => {
	const container = `cli-smoke-fn-live-${process.pid}-${image.replace(/[^a-z0-9]/gi, "")}`;
	let hostPort = "";
	const hostUrl = (): string =>
		`postgres://postgres@127.0.0.1:${hostPort}/postgres`;

	beforeAll(async () => {
		assertBuiltPackages();
		if (!dockerAvailable()) {
			throw new Error(
				"cli-smoke's vendored-fn live-witness suite needs a running Docker daemon (Docker Desktop, or colima: `colima start`) -- `docker info` failed. Next: start Docker and re-run `pnpm --filter cli-smoke test:integration`.",
			);
		}
		execFileSync(
			"docker",
			[
				"run",
				"-d",
				"--name",
				container,
				"-e",
				"POSTGRES_PASSWORD=postgres",
				"-e",
				"POSTGRES_HOST_AUTH_METHOD=trust",
				"-p",
				"127.0.0.1::5432",
				image,
			],
			{ stdio: "ignore" },
		);
		await waitUntilReady(container, 60);
		hostPort = containerPort(container);
	}, 120_000);

	afterAll(() => {
		execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
	});

	let schemaRepo = "";
	let consumerRepo = "";

	beforeEach(async () => {
		schemaRepo = await mkdtemp(
			join(tmpdir(), "hejbro-vendored-contract-live-schema-"),
		);
		consumerRepo = await mkdtemp(
			join(tmpdir(), "hejbro-vendored-contract-live-consumer-"),
		);
		await linkRuntimeDependencies(schemaRepo);
		await linkRuntimeDependencies(consumerRepo);
	});

	afterEach(async () => {
		await Promise.all([
			rm(schemaRepo, { recursive: true, force: true }),
			rm(consumerRepo, { recursive: true, force: true }),
		]);
	});

	it("calls a scalar and a table-returning vendored function against a real server, and gets real rows back", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await mkdir(join(schemaRepo, "src"), { recursive: true });
		await writeFile(join(schemaRepo, "src", "app.schema.ts"), SCHEMA_SOURCE);
		const generate = await runCli(schemaRepo, ["generate", "--export"]);
		expect(generate.exitCode).toBe(0);

		const migrate = await runCli(schemaRepo, ["migrate", "--url", hostUrl()]);
		expect(migrate.exitCode).toBe(0);

		await run("git", ["init", "-q"], schemaRepo);
		await run("git", ["config", "user.email", "smoke@example.com"], schemaRepo);
		await run("git", ["config", "user.name", "smoke"], schemaRepo);
		await run("git", ["add", "-A"], schemaRepo);
		const commit = await run(
			"git",
			["commit", "-q", "-m", "export"],
			schemaRepo,
		);
		expect(commit.exitCode).toBe(0);

		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		const liveCheckPath = join(consumerRepo, "live-check.ts");
		await writeFile(liveCheckPath, LIVE_CHECK_SOURCE);

		const check = await run(
			process.execPath,
			[liveCheckPath, hostUrl()],
			consumerRepo,
		);
		expect(check.stderr).toBe("");
		expect(check.exitCode).toBe(0);

		const result = JSON.parse(check.stdout.trim()) as {
			readonly insertedId: string;
			readonly insertedTitle: string;
			readonly total: string;
			readonly page: ReadonlyArray<{
				readonly id: string;
				readonly title: string;
			}>;
		};

		// The scalar call: `totalPosts`'s own body always returns 1,
		// ignoring its arg -- a real round trip, not a type-only claim.
		expect(result.total).toBe("1");

		// The table-returning call: the exact row this same vendored
		// client just inserted, read back through `post_by_id`, with an
		// explicit column list (proven at the type/SQL level already by
		// `parity.test.ts`; this is the same claim against a real server).
		expect(result.page).toEqual([
			{ id: result.insertedId, title: result.insertedTitle },
		]);
		expect(result.insertedTitle).toBe("hello from live-check");
	});
});
