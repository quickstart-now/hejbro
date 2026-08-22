import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

// Task 15: pins `hejbro --help` and `hejbro generate --help` to the
// owner-approved short-form texts (④ — decision ③'s grammar covers errors,
// not help; help stays a short summary, the full rename walkthrough is a
// GitHub Pages doc, Phase 7). citty colorizes its usage output regardless
// of TTY-ness (verified empirically against the built CLI) — NO_COLOR=1
// is required for a deterministic, ANSI-free capture.

const runHelp = (cwd: string, args: ReadonlyArray<string>) =>
	// biome-ignore lint/style/useNamingConvention: NO_COLOR is the env var itself (https://no-color.org), not a hejbro-authored identifier — its spelling isn't ours to change.
	runCli(cwd, args, { env: { ...process.env, NO_COLOR: "1" } });

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

describe("hejbro --help", () => {
	it("prints the owner-approved root description verbatim, ANSI-free under NO_COLOR", async () => {
		const result = await runHelp(cwd, ["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Declare your Postgres schema in TypeScript, generate deterministic migration SQL. Renames are handled non-interactively — run `hejbro generate --help` for the --rename/--confirm-drop flags.",
		);
		expect(result.stdout).not.toContain("[");
	});

	it("lists both subcommands", async () => {
		const result = await runHelp(cwd, ["--help"]);
		expect(result.stdout).toContain("init");
		expect(result.stdout).toContain("generate");
	});
});

describe("hejbro restore --help", () => {
	it("documents the migration number positional", async () => {
		const result = await runHelp(cwd, ["restore", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("hejbro restore [OPTIONS] [N]");
		expect(result.stdout).toContain(
			"the migration's number in `hejbro history` (1 = oldest)",
		);
	});
});

describe("hejbro generate --help", () => {
	it("prints the owner-approved two-paragraph description verbatim, ANSI-free under NO_COLOR", async () => {
		const result = await runHelp(cwd, ["generate", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"Diff your TypeScript declarations against the last snapshot and write a\nnew migration file.",
		);
		expect(result.stdout).toContain(
			"Renames are never confirmed interactively: if hejbro can't tell a\nrename from an unrelated drop and add, it exits 1 and prints the exact\n--rename/--confirm-drop command to rerun (see below).",
		);
		expect(result.stdout).not.toContain("[");
	});

	it("prints the owner-approved one-line descriptions for --config, --name, --rename, and --confirm-drop", async () => {
		const result = await runHelp(cwd, ["generate", "--help"]);
		expect(result.stdout).toContain(
			"path to hejbro.config.ts (default: ./hejbro.config.ts)",
		);
		expect(result.stdout).toContain(
			"migration slug override (default: derived from the first change, e.g. add_posts)",
		);
		expect(result.stdout).toContain(
			"confirm a rename: <schema>.<table>.<old>=<new> for a column, or <schema>.<old_table>=<new_table> for a table (repeatable)",
		);
		expect(result.stdout).toContain(
			"confirm a genuine drop (not a rename): <schema>.<table>.<column>, or <schema>.<table> for a whole table (repeatable)",
		);
	});
});
