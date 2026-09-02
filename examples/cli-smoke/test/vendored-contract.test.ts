import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// R2-G6 6.12's own round-trip proof: a contract `hejbro vendor` actually
// writes, type-checked by a real `tsc` against the real, installed
// `hejbro` package (never packages/cli's own aliased source) -- the one
// thing packages/cli's own unit tests can't prove, since they never
// leave the monorepo's own source tree.

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const TSC_PATH = join(EXAMPLE_ROOT, "node_modules", ".bin", "tsc");

const assertBuiltCli = (): void => {
	if (!existsSync(CLI_PATH)) {
		throw new Error(
			`built CLI artifact missing: ${CLI_PATH} -- run pnpm build (turbo should have built hejbro before its tests)`,
		);
	}
};

beforeAll(assertBuiltCli);

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

const linkHejbro = async (cwd: string): Promise<void> => {
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
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

let schemaRepo: string;
let consumerRepo: string;

beforeEach(async () => {
	schemaRepo = await mkdtemp(
		join(tmpdir(), "hejbro-vendored-contract-schema-"),
	);
	consumerRepo = await mkdtemp(
		join(tmpdir(), "hejbro-vendored-contract-consumer-"),
	);
	await linkHejbro(schemaRepo);
	await linkHejbro(consumerRepo);
});

afterEach(async () => {
	await Promise.all([
		rm(schemaRepo, { recursive: true, force: true }),
		rm(consumerRepo, { recursive: true, force: true }),
	]);
});

describe("a vendored contract type-checks against the real, installed hejbro package (R2-G6 6.12)", () => {
	it("hejbro vendor writes a contract.ts that tsc accepts with zero errors", async () => {
		// 1. The schema repository: init, declare, export, commit.
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await mkdir(join(schemaRepo, "src"), { recursive: true });
		await writeFile(join(schemaRepo, "src", "app.schema.ts"), SCHEMA_SOURCE);
		const generate = await runCli(schemaRepo, ["generate", "--export"]);
		expect(generate.exitCode).toBe(0);
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

		// 2. The consumer: link the schema repository, vendor it.
		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		const contractPath = join(consumerRepo, ".hejbro", "vendor", "contract.ts");
		const contractSource = await readFile(contractPath, "utf8");
		expect(contractSource).toContain("export interface Database");
		expect(contractSource).toContain("createNameKeyedDb<Database>");

		// 3. The real proof: a real `tsc`, resolving `hejbro` through the
		// consumer's own `node_modules/hejbro` symlink (built dist, never
		// packages/cli's aliased source), accepts this file outright.
		const check = await run(
			TSC_PATH,
			[
				"--noEmit",
				"--strict",
				"--moduleResolution",
				"bundler",
				"--module",
				"esnext",
				"--target",
				"es2022",
				contractPath,
			],
			consumerRepo,
		);
		expect(check.stdout).toBe("");
		expect(check.exitCode).toBe(0);
	});

	/**
	 * D106 m8: `query-type-inference`'s own "a vendored contract types a
	 * query … matches what the same query yields against the owning
	 * repository's declarations" had never been checked at the type
	 * level — only per-member (`contract-types.test.ts`) and by SQL
	 * parity (`parity.test.ts`). This is the missing observer: the same
	 * declarations, read two ways (a local `db()` handle and a vendored
	 * `createDb()` handle), compiled together by one real `tsc`, with a
	 * type-level equality check that only compiles if the two `select()`
	 * result types are structurally identical.
	 */
	it("a local db() handle and a vendored createDb() handle agree on a query's result type (D106 m8)", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await mkdir(join(schemaRepo, "src"), { recursive: true });
		await writeFile(join(schemaRepo, "src", "app.schema.ts"), SCHEMA_SOURCE);
		const generate = await runCli(schemaRepo, ["generate", "--export"]);
		expect(generate.exitCode).toBe(0);
		await run("git", ["init", "-q"], schemaRepo);
		await run("git", ["config", "user.email", "smoke@example.com"], schemaRepo);
		await run("git", ["config", "user.name", "smoke"], schemaRepo);
		await run("git", ["add", "-A"], schemaRepo);
		await run("git", ["commit", "-q", "-m", "export"], schemaRepo);

		const link = await runCli(consumerRepo, ["link", schemaRepo]);
		expect(link.exitCode).toBe(0);
		const vendor = await runCli(consumerRepo, ["vendor"]);
		expect(vendor.exitCode).toBe(0);

		// The same declarations the schema repository committed, copied
		// verbatim -- not imported across repositories (there is no
		// package boundary here to cross), just present so one `tsc`
		// invocation can type-check both paths against the identical
		// schema source.
		await writeFile(join(consumerRepo, "local-schema.ts"), SCHEMA_SOURCE);
		const parityCheckPath = join(consumerRepo, "type-parity-check.ts");
		await writeFile(
			parityCheckPath,
			`import type { Driver } from "hejbro";
import { db } from "hejbro";
import * as localSchema from "./local-schema";
import { createDb } from "./.hejbro/vendor/contract";

declare const driver: Driver;

const localHandle = db(localSchema, driver);
const vendoredHandle = createDb(driver);

const localChain = localHandle.select(localSchema.posts);
const vendoredChain = vendoredHandle.posts.select();

type LocalRow = Awaited<typeof localChain>[number];
type VendoredRow = Awaited<typeof vendoredChain>[number];

type AssertEqual<A, B> = A extends B ? (B extends A ? true : false) : false;
// Fails to compile (never is not assignable to true) if the two
// result types are not structurally identical.
const _typesAgree: AssertEqual<LocalRow, VendoredRow> = true;
void _typesAgree;
`,
		);

		const check = await run(
			TSC_PATH,
			[
				"--noEmit",
				"--strict",
				"--moduleResolution",
				"bundler",
				"--module",
				"esnext",
				"--target",
				"es2022",
				parityCheckPath,
			],
			consumerRepo,
		);
		expect(check.stdout).toBe("");
		expect(check.exitCode).toBe(0);
	});
});
