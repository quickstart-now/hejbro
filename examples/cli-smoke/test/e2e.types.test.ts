import type { ExecException } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Task 18 acceptance: drives the *built* CLI (dist/cli.js, not any
// in-process import) against a tmp copy of this example — the closest
// thing to how a real user runs hejbro, and immune to the jiti/vitest
// cross-module-instance risk documented in packages/cli's own tests
// (see packages/cli/test/support/cli-runner.ts, which this mirrors).

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");
const CLI_INDEX_PATH = join(CLI_PACKAGE_ROOT, "dist", "index.js");
const CORE_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "core");

/** Mirrors packages/cli/test/support/cli-runner.ts's `newestMtimeMs`. */
const newestMtimeMs = (dir: string): number => {
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.reduce((newest, entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			return Math.max(newest, newestMtimeMs(fullPath));
		}
		return Math.max(newest, statSync(fullPath).mtimeMs);
	}, 0);
};

/** Mirrors packages/cli/test/support/cli-runner.ts's `assertFreshBuild` (#131) — this test spawns the built CLI, so it can't see an unbuilt source edit any other way. */
const assertFreshBuild = (label: string, packageRoot: string): void => {
	const srcMtime = newestMtimeMs(join(packageRoot, "src"));
	const distMtime = newestMtimeMs(join(packageRoot, "dist"));
	if (distMtime < srcMtime) {
		throw new Error(
			`${label}'s dist/ is older than its src/ (stale build) — Next: run \`pnpm build --force\` (a plain \`pnpm build\` can replay a cached run without rewriting dist).`,
		);
	}
};

/** Mirrors packages/cli/test/support/cli-runner.ts's `assertBuiltCli` (#102, #131) — a confusing "no such file" spawn error otherwise hides an incomplete build, and a stale-but-present one hides a silent false green. */
const assertBuiltCli = (): void => {
	const missing = [CLI_PATH, CLI_INDEX_PATH].filter((p) => !existsSync(p));
	if (missing.length > 0) {
		throw new Error(
			`built CLI artifacts missing: ${missing.join(", ")} — run pnpm build (turbo should have built hejbro before its tests; if you see this under turbo, capture the turbo log for #102)`,
		);
	}
	assertFreshBuild("@hejbro/core", CORE_PACKAGE_ROOT);
	assertFreshBuild("hejbro", CLI_PACKAGE_ROOT);
};

beforeAll(assertBuiltCli);

type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

// `ExecException.code` is `string | number | undefined` (unlike
// `NodeJS.ErrnoException.code`, which is `string | undefined`) — typed to
// match what `execFile`'s callback actually hands us, so this compiles
// under `exactOptionalPropertyTypes` (same fix as examples/postgres).
const exitCodeFrom = (error: ExecException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

/** True when `stderr` is one of hejbro's own diagnostic blocks (`error[<code>]: ...`, §7 grammar) — an *expected* non-zero exit this test asserted on, not a spawn/crash symptom worth logging (#102, mirrors packages/cli/test/support/cli-runner.ts). */
const isHejbroDiagnostic = (stderr: string): boolean =>
	stderr.trimStart().startsWith("error[");

const runCli = (cwd: string, args: ReadonlyArray<string>): Promise<CliRun> =>
	new Promise((resolve) => {
		execFile(
			process.execPath,
			[CLI_PATH, ...args],
			{ cwd },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr });
					return;
				}
				const exitCode = exitCodeFrom(error);
				// Keep the full child stderr in the report even when the test's
				// own assertions don't inspect it — a flaky failure otherwise
				// leaves no trace of what the spawned CLI actually printed (#102).
				// Skip the log for hejbro's own diagnostics: those are expected
				// non-zero exits this test asserted on.
				if (!isHejbroDiagnostic(stderr)) {
					console.error(`[cli-runner] exit ${exitCode}\n${stderr}`);
				}
				resolve({ exitCode, stdout, stderr });
			},
		);
	});

// customers.email → customers.emailAddress (email_address) — a
// single-pair same-table drop+add, exercising the ambiguous-column-rename
// path end to end.
// D81 (#261): `phone` is declared *between* `id` and `email` in the
// TypeScript object, but the table already exists (the first `generate`
// created it) — hejbro's snapshot must land `phone` *last*, matching what
// Postgres itself does for a real `add column`, not where it sits in the
// object literal.
const MID_INSERT_SCHEMA_SOURCE = `import { index, schema, table, text, timestamp, uuid } from "hejbro";

export const shop = schema("shop");

export const customers = table(shop, "customers", {
	id: uuid().primaryKey().defaultRandom(),
	phone: text(),
	email: text().notNull(),
	createdAt: timestamp().notNull().defaultNow(),
});

export const orders = table(
	shop,
	"orders",
	{
		id: uuid().primaryKey().defaultRandom(),
		customerId: uuid().notNull(),
		placedAt: timestamp().notNull().defaultNow(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.customerId],
				references: { table: customers, columns: [customers.id] },
				onDelete: "cascade",
			},
		],
		indexes: [index().on(t.customerId)],
	}),
);
`;

const RENAMED_SCHEMA_SOURCE = `import { index, schema, table, text, timestamp, uuid } from "hejbro";

export const shop = schema("shop");

export const customers = table(shop, "customers", {
	id: uuid().primaryKey().defaultRandom(),
	phone: text(),
	emailAddress: text().notNull(),
	createdAt: timestamp().notNull().defaultNow(),
});

export const orders = table(
	shop,
	"orders",
	{
		id: uuid().primaryKey().defaultRandom(),
		customerId: uuid().notNull(),
		placedAt: timestamp().notNull().defaultNow(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.customerId],
				references: { table: customers, columns: [customers.id] },
				onDelete: "cascade",
			},
		],
		indexes: [index().on(t.customerId)],
	}),
);
`;

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-cli-smoke-"));
	await cp(
		join(EXAMPLE_ROOT, "hejbro.config.ts"),
		join(cwd, "hejbro.config.ts"),
	);
	await mkdir(join(cwd, "src"), { recursive: true });
	await cp(
		join(EXAMPLE_ROOT, "src", "app.schema.ts"),
		join(cwd, "src", "app.schema.ts"),
	);
	// A tmp dir outside the workspace has no node_modules, so the
	// fixture's `import { ... } from "hejbro"` (U2 self-import cycle)
	// can't resolve on its own — link straight to the built package.
	await mkdir(join(cwd, "node_modules"), { recursive: true });
	await symlink(CLI_PACKAGE_ROOT, join(cwd, "node_modules", "hejbro"), "dir");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const migrationFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

describe("hejbro cli-smoke e2e (built CLI, tmp copy of examples/cli-smoke)", () => {
	it("init → generate → generate (no changes) → verify → rename → generate (ambiguous) → generate --rename → verify", async () => {
		// 1. init → three artifacts exist.
		const initResult = await runCli(cwd, ["init"]);
		expect(initResult.exitCode).toBe(0);
		const [configExists, migrationsDirExists, snapshotExists] =
			await Promise.all([
				readFile(join(cwd, "hejbro.config.ts"), "utf8").then(
					() => true,
					() => false,
				),
				readdir(join(cwd, "migrations")).then(
					() => true,
					() => false,
				),
				readFile(join(cwd, "hejbro.snapshot.json"), "utf8").then(
					() => true,
					() => false,
				),
			]);
		expect(configExists).toBe(true);
		expect(migrationsDirExists).toBe(true);
		expect(snapshotExists).toBe(true);

		// 2. generate → migration file written; banner has `+` lines and
		// both hash lines; snapshot non-empty.
		const firstGenerate = await runCli(cwd, ["generate"]);
		expect(firstGenerate.exitCode).toBe(0);
		const [firstFileName] = await migrationFileNames();
		expect(firstFileName).toBeDefined();
		const firstMigrationText = await readFile(
			join(cwd, "migrations", firstFileName as string),
			"utf8",
		);
		expect(firstMigrationText).toContain("+ table shop.customers");
		expect(firstMigrationText).toContain("+ table shop.orders");
		expect(firstMigrationText).toContain("-- parent-snapshot: sha256:");
		expect(firstMigrationText).toContain("-- snapshot: sha256:");
		const snapshotAfterFirstGenerate = await readFile(
			join(cwd, "hejbro.snapshot.json"),
			"utf8",
		);
		expect(snapshotAfterFirstGenerate).toContain('"table:shop.customers"');
		expect(snapshotAfterFirstGenerate).toContain('"table:shop.orders"');

		// 3. generate again → "no changes", exit 0, no new file.
		const secondGenerate = await runCli(cwd, ["generate"]);
		expect(secondGenerate.exitCode).toBe(0);
		expect(secondGenerate.stdout).toContain(
			"no changes — snapshot already matches your declarations.",
		);
		expect(await migrationFileNames()).toHaveLength(1);

		// 4. verify → exit 0.
		const firstVerify = await runCli(cwd, ["verify"]);
		expect(firstVerify.exitCode).toBe(0);
		expect(firstVerify.stdout).toContain("verify: 5 checks passed");

		// 4b. D81 (#261): insert a column mid-declaration on the already-
		// existing customers table → generate writes a plain `add column`
		// migration → verify still passes (the CLI round-trip regression
		// for #261: before the fix, verify's rebuild used an empty parent
		// and disagreed with the committed snapshot's physical order).
		await writeFile(
			join(cwd, "src", "app.schema.ts"),
			MID_INSERT_SCHEMA_SOURCE,
		);

		const midInsertGenerate = await runCli(cwd, ["generate"]);
		expect(midInsertGenerate.exitCode).toBe(0);
		expect(await migrationFileNames()).toHaveLength(2);

		const midInsertVerify = await runCli(cwd, ["verify"]);
		expect(midInsertVerify.exitCode).toBe(0);
		expect(midInsertVerify.stdout).toContain("verify: 5 checks passed");

		// 5. rename a column in the fixture source → generate exits 1 with
		// ambiguous-column-rename → rerun with the suggested --rename →
		// RENAME migration written → verify exits 0.
		await writeFile(join(cwd, "src", "app.schema.ts"), RENAMED_SCHEMA_SOURCE);

		const ambiguousGenerate = await runCli(cwd, ["generate"]);
		expect(ambiguousGenerate.exitCode).toBe(1);
		expect(ambiguousGenerate.stderr).toContain(
			"error[ambiguous-column-rename]",
		);
		expect(ambiguousGenerate.stderr).toContain(
			"shop.customers.email=email_address",
		);
		expect(await migrationFileNames()).toHaveLength(2);

		const renameGenerate = await runCli(cwd, [
			"generate",
			"--rename",
			"shop.customers.email=email_address",
		]);
		expect(renameGenerate.exitCode).toBe(0);
		const fileNamesAfterRename = await migrationFileNames();
		expect(fileNamesAfterRename).toHaveLength(3);
		const renameMigrationTexts = await Promise.all(
			fileNamesAfterRename.map((name) =>
				readFile(join(cwd, "migrations", name), "utf8"),
			),
		);
		expect(
			renameMigrationTexts.some((text) =>
				text.includes(
					'alter table "shop"."customers" rename column "email" to "email_address";',
				),
			),
		).toBe(true);

		const secondVerify = await runCli(cwd, ["verify"]);
		expect(secondVerify.exitCode).toBe(0);
		expect(secondVerify.stdout).toContain("verify: 5 checks passed");
	});
});
