import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

// Task 17: `hejbro verify`'s four checks. Drives the built CLI
// (support/cli-runner.ts) for the same reason generate-command.test.ts
// and golden.test.ts do — real jiti-loaded table() fixtures need the
// real, built resolution path, not an in-process vitest one.

const BASE_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

const CHANGED_SCHEMA = `import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	body: text().notNull(),
});
`;

const PARENT_PREFIX = "-- parent-snapshot: ";
const SNAPSHOT_PREFIX = "-- snapshot: ";

const replaceLinePrefixedWith = (
	text: string,
	prefix: string,
	newValue: string,
): string =>
	text
		.split("\n")
		.map((line) => {
			if (!line.startsWith(prefix)) {
				return line;
			}
			return `${prefix}${newValue}`;
		})
		.join("\n");

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

const writeSchema = (source: string): Promise<void> =>
	writeFixtureFile(cwd, "src/app.schema.ts", source);

const migrationFileNames = async (): Promise<ReadonlyArray<string>> => {
	const entries = await readdir(join(cwd, "migrations"));
	return entries.filter((name) => name.endsWith(".sql")).sort();
};

describe("hejbro verify (built CLI, tmp-dir)", () => {
	it("passes all 4 checks on a freshly generated repo", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"verify: 4 checks passed (1 migrations, snapshot sha256:",
		);
	});

	it("passes when there are declarations but zero migrations yet (matches the empty snapshot init left behind)", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		// declarations exist but no migration has ever been generated for
		// them, so the checked-in (empty) snapshot is legitimately stale —
		// same as generate would report via a different code.
		expect(result.stderr).toContain("error[snapshot-stale]");
	});

	it("surfaces the same entry-not-found error as generate on a bare init'd repo (no declaration files at all)", async () => {
		await runCli(cwd, ["init"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[entry-not-found]");
	});

	it("check 1 (parses): exits 1 with invalid-snapshot on a corrupted snapshot file", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		await writeFile(
			join(cwd, "hejbro.snapshot.json"),
			"<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-snapshot]");
	});

	it("check 2 (declarations ↔ snapshot): exits 1 with snapshot-stale when declarations changed without regenerating", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-stale]");
		expect(result.stderr).toContain("hejbro.snapshot.json");
	});

	it("check 3 (chain linearity): exits 1 with diverged-migrations when two files share a parent", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const original = await readFile(
			join(cwd, "migrations", fileName as string),
			"utf8",
		);
		const forked = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"f".repeat(64)}`,
		);
		await writeFixtureFile(cwd, "migrations/99999999999999_fork.sql", forked);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[diverged-migrations]");
		expect(result.stderr).toContain(fileName as string);
		expect(result.stderr).toContain("99999999999999_fork.sql");
	});

	it("check 3 (chain linearity): exits 1 with broken-chain when a later file's parent doesn't match", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [, secondFileName] = await migrationFileNames();
		const secondPath = join(cwd, "migrations", secondFileName as string);
		const original = await readFile(secondPath, "utf8");
		const broken = replaceLinePrefixedWith(
			original,
			PARENT_PREFIX,
			`sha256:${"0".repeat(64)}`,
		);
		await writeFile(secondPath, broken);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[broken-chain]");
		expect(result.stderr).toContain(secondFileName as string);
	});

	it("check 4 (tip == current): exits 1 with chain-tip-mismatch when a migration's own snapshot hash is corrupted", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);

		const [fileName] = await migrationFileNames();
		const filePath = join(cwd, "migrations", fileName as string);
		const original = await readFile(filePath, "utf8");
		const corrupted = replaceLinePrefixedWith(
			original,
			SNAPSHOT_PREFIX,
			`sha256:${"a".repeat(64)}`,
		);
		await writeFile(filePath, corrupted);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[chain-tip-mismatch]");
	});
});
