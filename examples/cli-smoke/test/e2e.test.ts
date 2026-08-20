import { execFile } from "node:child_process";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Task 18 acceptance: drives the *built* CLI (dist/cli.js, not any
// in-process import) against a tmp copy of this example — the closest
// thing to how a real user runs hejbro, and immune to the jiti/vitest
// cross-module-instance risk documented in packages/cli's own tests
// (see packages/cli/test/support/cli-runner.ts, which this mirrors).

const EXAMPLE_ROOT = join(import.meta.dirname, "..");
const CLI_PACKAGE_ROOT = join(EXAMPLE_ROOT, "..", "..", "packages", "cli");
const CLI_PATH = join(CLI_PACKAGE_ROOT, "dist", "cli.js");

type CliRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

const exitCodeFrom = (error: NodeJS.ErrnoException): number => {
	if (typeof error.code === "number") {
		return error.code;
	}
	return 1;
};

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
				resolve({ exitCode: exitCodeFrom(error), stdout, stderr });
			},
		);
	});

// customers.email → customers.emailAddress (email_address) — a
// single-pair same-table drop+add, exercising the ambiguous-column-rename
// path end to end.
const RENAMED_SCHEMA_SOURCE = `import { index, schema, table, text, timestamp, uuid } from "hejbro";

export const shop = schema("shop");

export const customers = table(shop, "customers", {
	id: uuid().primaryKey().defaultRandom(),
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
		expect(firstVerify.stdout).toContain("verify: 4 checks passed");

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
		expect(await migrationFileNames()).toHaveLength(1);

		const renameGenerate = await runCli(cwd, [
			"generate",
			"--rename",
			"shop.customers.email=email_address",
		]);
		expect(renameGenerate.exitCode).toBe(0);
		const fileNamesAfterRename = await migrationFileNames();
		expect(fileNamesAfterRename).toHaveLength(2);
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
		expect(secondVerify.stdout).toContain("verify: 4 checks passed");
	});
});
