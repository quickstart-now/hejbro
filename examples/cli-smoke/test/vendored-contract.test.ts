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

const SCHEMA_SOURCE = `import { bigint, defineFunction, interval, schema, select, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	// #661: an interval column -- its value type (IntervalValue) must
	// resolve in the vendored contract without a manual import.
	checkIn: interval(),
});

// #661: a function argument naming interval, the second of the two
// places the delta requires it to compile.
export const waitFor = defineFunction(
	app,
	"wait_for",
	{ args: { delay: interval() }, returns: bigint() },
	(ctx) => {
		ctx.return(sql\`1\`);
	},
);

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

// #662: a function argument keyed by something that is not a valid TS
// identifier -- the DSL accepts it (only table columns go through D36's
// assertSqlName), so this is the one place a non-identifier key reaches
// a real, vendored contract that a real tsc actually compiles. Contract
// axis only -- the DDL this same declaration would generate renders the
// argument name unquoted and is invalid SQL (#679).
export const echoArg = defineFunction(
	app,
	"echo_arg",
	{ args: { "my-arg": uuid() }, returns: uuid() },
	(ctx, args) => {
		ctx.return(sql\`\${args["my-arg"]}\`);
	},
);
`;

/**
 * add-unmanaged-objects, 3.2 (type witness): `authUsers` is exported --
 * a real declaration, per group 1 -- so it reaches the snapshot, the
 * export, and the vendored contract's own `Tables` entry (3.1). The
 * mutant version below drops only the `export` keyword, the same
 * declared-vs-undeclared axis `contract-emit.test.ts`'s own "no relation
 * is derived for an unmanaged target" already pins.
 */
const EXISTING_SCHEMA_SOURCE = `import { existingTable, schema, table, uuid } from "hejbro";

export const app = schema("app");

export const authUsers = existingTable("auth", "users", {
	id: uuid(),
});

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	authorId: uuid().notNull().references(() => authUsers.id),
});
`;

/** [mutant] `authUsers` built but never exported -- back on the undeclared axis, matching what `examples/supabase` does today (import + inline FK reference only). */
const EXISTING_SCHEMA_SOURCE_UNDECLARED = `import { existingTable, schema, table, uuid } from "hejbro";

export const app = schema("app");

const authUsers = existingTable("auth", "users", {
	id: uuid(),
});

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	authorId: uuid().notNull().references(() => authUsers.id),
});
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

// The function sibling of the same claim (#587/G3) -- type-only, never
// invoked (the live half belongs to 3.2): a scalar-returning fn and a
// table-returning fn, compared as whole call signatures (arguments AND
// result), read two ways through one real tsc.
type LocalTotalPosts = typeof localHandle.fn.totalPosts;
type VendoredTotalPosts = typeof vendoredHandle.fn.totalPosts;
const _totalPostsFnTypesAgree: AssertEqual<
	LocalTotalPosts,
	VendoredTotalPosts
> = true;
void _totalPostsFnTypesAgree;

type LocalPostById = typeof localHandle.fn.postById;
type VendoredPostById = typeof vendoredHandle.fn.postById;
const _postByIdFnTypesAgree: AssertEqual<LocalPostById, VendoredPostById> =
	true;
void _postByIdFnTypesAgree;
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

	/**
	 * add-unmanaged-objects, 3.2 (type witness): the same D106 m8 parity
	 * idiom as the test above, applied to a declared existing table --
	 * proves the vendored contract's own `Tables["users"]` row type
	 * (built from `contractMetadata`, 3.1) is structurally identical to
	 * a local `db()` handle's row type for the same `existingTable()`
	 * declaration, and that a managed table's FK column onto it types
	 * as a plain `string` either way (the column itself, not a joined
	 * value -- `.related()` isn't exposed on the vendored client yet,
	 * D102/owner-seal "가", so this proves row-type parity for the
	 * existing table's own declared columns, not automatic relation
	 * following).
	 */
	it("a declared existing table's row type is identical on a vendored client and a local db() handle", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await mkdir(join(schemaRepo, "src"), { recursive: true });
		await writeFile(
			join(schemaRepo, "src", "app.schema.ts"),
			EXISTING_SCHEMA_SOURCE,
		);
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

		await writeFile(
			join(consumerRepo, "local-schema.ts"),
			EXISTING_SCHEMA_SOURCE,
		);
		const parityCheckPath = join(consumerRepo, "existing-type-parity-check.ts");
		await writeFile(
			parityCheckPath,
			`import type { Driver } from "hejbro";
import { db } from "hejbro";
import * as localSchema from "./local-schema";
import { createDb } from "./.hejbro/vendor/contract";

declare const driver: Driver;

const localHandle = db(localSchema, driver);
const vendoredHandle = createDb(driver);

const localChain = localHandle.select(localSchema.authUsers);
const vendoredChain = vendoredHandle.users.select();

type LocalRow = Awaited<typeof localChain>[number];
type VendoredRow = Awaited<typeof vendoredChain>[number];

type AssertEqual<A, B> = A extends B ? (B extends A ? true : false) : false;
const _existingRowTypesAgree: AssertEqual<LocalRow, VendoredRow> = true;
void _existingRowTypesAgree;

// The managed table's FK column onto the existing one types as a plain
// string -- the column, not a joined value (no .related() sugar yet).
const postsChain = vendoredHandle.posts.select();
type VendoredPostsRow = Awaited<typeof postsChain>[number];
const _authorIdIsString: AssertEqual<
	VendoredPostsRow["authorId"],
	string
> = true;
void _authorIdIsString;
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

	/**
	 * add-unmanaged-objects, 3.2 mutant (type half): the exact same
	 * consumer code as the test above, against a schema that builds the
	 * identical `existingTable()` but never exports it (undeclared
	 * axis) -- `vendoredHandle.users` does not exist on the vendored
	 * `Database["Tables"]` at all (3.1: an unexported table never
	 * reaches the snapshot/export/contract), so `tsc` must fail, not
	 * `vitest`. Pinned as its own test (not a mutant reverted after the
	 * fact) so CI itself proves the type pin is load-bearing on every
	 * run, mirroring `contract-emit.test.ts`'s own undeclared-axis
	 * control.
	 */
	it("an undeclared existing table has no entry to type-check against, so the same consumer code fails tsc", async () => {
		const init = await runCli(schemaRepo, ["init"]);
		expect(init.exitCode).toBe(0);
		await mkdir(join(schemaRepo, "src"), { recursive: true });
		await writeFile(
			join(schemaRepo, "src", "app.schema.ts"),
			EXISTING_SCHEMA_SOURCE_UNDECLARED,
		);
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

		await writeFile(
			join(consumerRepo, "local-schema.ts"),
			EXISTING_SCHEMA_SOURCE_UNDECLARED,
		);
		const parityCheckPath = join(consumerRepo, "existing-type-parity-check.ts");
		await writeFile(
			parityCheckPath,
			`import { createDb } from "./.hejbro/vendor/contract";
import type { Driver } from "hejbro";

declare const driver: Driver;

const vendoredHandle = createDb(driver);
const vendoredChain = vendoredHandle.users.select();
void vendoredChain;
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
		expect(check.exitCode).not.toBe(0);
		expect(check.stdout).toContain("users");
	});
});
