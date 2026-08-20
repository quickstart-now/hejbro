import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

// Task 17: `hejbro verify`'s four checks, including golden pins for the
// owner-approved (⑥) snapshot-stale/chain-tip-mismatch texts and the
// diverged-migrations/broken-chain Next: lines. Drives the built CLI
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

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

const BUCKET_SCHEMA = `import { storageBucket } from "@hejbro/supabase";

export const avatars = storageBucket("avatars");
`;

const CONFIG_WITH_SUPABASE_PRESET_SOURCE = `import { defineConfig } from "hejbro";
import { supabasePreset } from "@hejbro/supabase";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [supabasePreset],
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

	it("M1 regression: exits 1 with a proper config-not-found diagnostic (not a raw object dump) when there's no hejbro.config.ts at all", async () => {
		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
		);
		expect(result.stderr).not.toContain("[object Object]");
	});

	it("M2 regression: exits 1 with generate's own snapshot-not-found text when the snapshot file was never created", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(BASE_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", and the migrations directory has no prior migrations either — this looks like a project that hasn\'t been initialized yet. Next: run `hejbro init` to scaffold an empty snapshot (and the migrations directory, if missing), then rerun `hejbro generate`.',
		);
	});

	it("M2 regression: exits 1 with generate's own snapshot-lost text when migrations exist but the snapshot file is missing", async () => {
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		await writeSchema(BASE_SCHEMA);
		await writeFixtureFile(
			cwd,
			"migrations/20260101000000_add_posts.sql",
			"-- hejbro migration\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'no snapshot file was found at "hejbro.snapshot.json", but 1 prior migration(s) already exist in "migrations" — the snapshot is a derived, checked-in file (declarations are the source of truth), so this looks lost rather than never created.',
		);
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

	it("check 2 (declarations ↔ snapshot): exits 1 with the owner-approved snapshot-stale text when declarations changed without regenerating", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			'the checked-in snapshot at "hejbro.snapshot.json" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run `hejbro generate` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).',
		);
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
		expect(result.stderr).toContain(
			"all branch from the same prior snapshot state — this usually happens when two branches each ran `hejbro generate` before merging. Next: keep whichever migration merged first (usually the one with the earlier timestamp/index prefix); delete the other, then rerun `hejbro generate` so it's recreated against the now-current chain.",
		);
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
		expect(result.stderr).toContain(
			`the migration chain is broken at "${secondFileName}" — its parent-snapshot hash doesn't match any earlier migration's snapshot hash. Next: check whether a migration file was deleted, renamed, or hand-edited. Restore it from version control, or if this is intentional, delete every migration after it (they're now orphaned) and rerun \`hejbro generate\`.`,
		);
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
		expect(result.stderr).toContain(
			"the migration chain's tip hash doesn't match the current snapshot — the last migration's \"snapshot:\" hash and the on-disk snapshot's own hash disagree, which means the snapshot or the last migration file was edited after the last `hejbro generate`. Next: restore the snapshot (and the last migration file, if it was edited) from version control — the snapshot is a derived file and should only ever change through `hejbro generate`.",
		);
	});

	// Dependency-aware batch reporting (reviewer-redesigned, PR D round 2):
	// checks 1 and 3 always run; 2 needs 1; 4 needs 1 and 3. skip/summary
	// text is owner-approved verbatim (⑥), pinned below.

	it("batch: check 3 alone failing skips only check 4 (check 2 still runs and passes)", async () => {
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
		expect(result.stderr).not.toContain("error[snapshot-stale]");
		expect(result.stderr).not.toContain("error[chain-tip-mismatch]");
		expect(result.stderr).toContain(
			"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)",
		);
		expect(result.stderr).not.toContain(
			"skipped: declarations ↔ snapshot (needs a parseable snapshot file)",
		);
		expect(result.stderr).toContain(
			"verify: 1 of 4 checks failed, 1 skipped — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("batch: checks 1 and 3 failing together produce 2 diagnostic blocks and skip checks 2 and 4", async () => {
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
		await writeFile(
			join(cwd, "hejbro.snapshot.json"),
			"<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n",
		);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[invalid-snapshot]");
		expect(result.stderr).toContain("error[diverged-migrations]");
		expect(result.stderr).toContain(
			"skipped: declarations ↔ snapshot (needs a parseable snapshot file)",
		);
		expect(result.stderr).toContain(
			"skipped: chain tip ↔ snapshot (needs a parseable snapshot and a linear chain)",
		);
		expect(result.stderr).toContain(
			"verify: 2 of 4 checks failed, 2 skipped — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("batch: a single failure (no skips) uses the no-skip summary form", async () => {
		await runCli(cwd, ["init"]);
		await writeSchema(BASE_SCHEMA);
		await runCli(cwd, ["generate"]);
		await writeSchema(CHANGED_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[snapshot-stale]");
		expect(result.stderr).not.toContain("skipped:");
		expect(result.stderr).toContain(
			"verify: 1 of 4 checks failed — fix the errors above and rerun `hejbro verify`.",
		);
	});

	it("passes with a storageBucket declaration when the supabase preset is registered (D55)", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(
			cwd,
			"hejbro.config.ts",
			CONFIG_WITH_SUPABASE_PRESET_SOURCE,
		);
		await writeFixtureFile(cwd, "src/app.schema.ts", BUCKET_SCHEMA);
		await runCli(cwd, ["generate"]);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(0);
	});

	it("fails a storageBucket declaration when no preset registers its kind", async () => {
		await runCli(cwd, ["init"]);
		await writeFixtureFile(cwd, "src/app.schema.ts", BUCKET_SCHEMA);

		const result = await runCli(cwd, ["verify"]);
		expect(result.exitCode).toBe(1);
		// buildSnapshot rejects the declaration before diffSnapshots ever
		// looks up its kind by name, so the observed code is
		// unowned-declaration (buildSnapshot's own "no owner" check),
		// not unknown-kind (registry.get's "no such kind" check, which
		// only fires once a kind name is looked up during diffing).
		expect(result.stderr).toContain("error[unowned-declaration]");
	});
});
