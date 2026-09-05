import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { isTable } from "@hejbro/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadDeclarations } from "../src/loader";

const schemaNameOf = (declaration: HejbroInput): string | null => {
	if (typeof declaration !== "object" || declaration === null) {
		return null;
	}
	if (
		"schemaName" in declaration &&
		typeof declaration.schemaName === "string"
	) {
		return declaration.schemaName;
	}
	return null;
};

const fixturesDir = join(import.meta.dirname, "fixtures");

describe("loadConfig", () => {
	// #745: the config path a diagnostic prints is the label the user would
	// type, never the resolved absolute path -- the CLI's own rule for
	// every message it writes.
	it("names the config file by its relative label in invalid-config, never by absolute path", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "hejbro-745-"));
		await writeFile(join(cwd, "hejbro.config.ts"), "export default { entry: 42 };\n");
		try {
			await loadConfig(cwd, undefined);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid-config" });
			const message = (error as { message: string }).message;
			expect(message).toContain('config field "entry" in hejbro.config.ts');
			expect(message).not.toContain(cwd);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it('loads the default export via jiti.import(path, { default: true }) — also exercises the U2 self-import cycle (hejbro.config.ts importing from "hejbro")', async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		expect(configPath).toBe(join(cwd, "hejbro.config.ts"));
		expect(config).toEqual({
			entry: ["src/**/*.schema.ts"],
			migrationsDir: "migrations",
			snapshotPath: "hejbro.snapshot.json",
			prefixStrategy: "timestamp",
			presets: [],
		});
	});

	it("resolves --config relative to cwd", async () => {
		const cwd = fixturesDir;
		const { configPath } = await loadConfig(cwd, "basic/hejbro.config.ts");
		expect(configPath).toBe(join(fixturesDir, "basic", "hejbro.config.ts"));
	});

	it("throws config-not-found with the owner-approved text verbatim (no absolute paths)", async () => {
		const cwd = join(fixturesDir, "entry-not-found", "no-such-dir");
		try {
			await loadConfig(cwd, undefined);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "config-not-found",
				message:
					"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
			});
		}
	});
});

// #846 D5 (#830, NB8, #831): --config names a file. An empty value used
// to resolve to cwd and refuse it as an existing "directory"; a missing
// file under --config always named the default hejbro.config.ts in its
// Next:; a directory or a dangling link at the configured path reached
// jiti and surfaced as an import-resolution failure instead of a coded
// refusal naming the real fault.
describe("loadConfig / resolveConfigPath — --config names a file (#846 D5)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "hejbro-loader-config-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it.each(["", "   "])(
		"refuses an empty --config value, never resolving it to the working directory (%j)",
		async (value) => {
			try {
				await loadConfig(cwd, value);
				throw new Error("expected loadConfig to throw");
			} catch (error) {
				expect(error).toMatchObject({ code: "invalid-config-flag" });
				const message = (error as { message: string }).message;
				// #846 review N2: the message opens with a quoted "--config"
				// so identityFromMessage's header reads
				// error[invalid-config-flag]: --config on every command.
				expect(message.startsWith('"--config" was given')).toBe(true);
				expect(message).toContain("--config path/to/hejbro.config.ts");
				expect(message).not.toContain("directory");
			}
		},
	);

	it("names the path actually looked up under --config in config-not-found's Next:", async () => {
		try {
			await loadConfig(cwd, "sub/h.ts");
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain('"sub/h.ts"');
			expect(message).toContain("hejbro init --config sub/h.ts");
		}
	});

	// #846 review B3: D57's "never an absolute path" rule protects a path
	// hejbro discovered on the machine, not a value the user typed back
	// to them -- the header and the "found at" body clause stay
	// cwd-relative, but Next: echoes the --config value verbatim (the
	// one documented exception).
	it("names an absolute --config path relative to cwd in the header and body, but echoes it verbatim in Next:", async () => {
		const outsideDir = await mkdtemp(join(tmpdir(), "hejbro-loader-outside-"));
		try {
			const absolutePath = join(outsideDir, "h.ts");
			try {
				await loadConfig(cwd, absolutePath);
				throw new Error("expected loadConfig to throw");
			} catch (error) {
				expect(error).toMatchObject({ code: "config-not-found" });
				const message = (error as { message: string }).message;
				const nextIndex = message.indexOf("Next:");
				const body = message.slice(0, nextIndex);
				const next = message.slice(nextIndex);
				expect(body).not.toContain(cwd);
				expect(body).not.toContain(outsideDir);
				expect(next).toContain(`--config ${absolutePath}`);
			}
		} finally {
			await rm(outsideDir, { recursive: true, force: true });
		}
	});

	it("refuses a directory at --config as config-not-a-file, naming it once", async () => {
		await mkdir(join(cwd, "sub", "h.ts"), { recursive: true });
		try {
			await loadConfig(cwd, "sub/h.ts");
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-a-file" });
			const message = (error as { message: string }).message;
			const occurrences = message.split('"sub/h.ts"').length - 1;
			expect(occurrences).toBe(2); // header + one body mention
			expect(message).toContain("--config");
		}
	});

	it("refuses a directory at the default hejbro.config.ts as config-not-a-file", async () => {
		await mkdir(join(cwd, "hejbro.config.ts"), { recursive: true });
		try {
			await loadConfig(cwd, undefined);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-a-file" });
		}
	});

	it("refuses a dangling link at --config as config-not-a-file, naming the link and its target", async () => {
		await symlink("nowhere", join(cwd, "h.ts"));
		try {
			await loadConfig(cwd, "h.ts");
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-a-file" });
			const message = (error as { message: string }).message;
			expect(message).toContain("h.ts");
			expect(message).toContain("nowhere");
		}
	});

	it("loads through a --config link to a real configuration file (control)", async () => {
		await writeFile(
			join(cwd, "real.ts"),
			'export default { entry: ["src/**/*.schema.ts"] };\n',
		);
		await symlink("real.ts", join(cwd, "h.ts"));

		const { config } = await loadConfig(cwd, "h.ts");

		expect(config.entry).toEqual(["src/**/*.schema.ts"]);
	});

	it("names the file in the way when an ancestor of --config is a regular file", async () => {
		await writeFile(join(cwd, "f"), "not a directory");
		try {
			await loadConfig(cwd, "f/h.ts");
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-unreadable" });
			const message = (error as { message: string }).message;
			expect(message).toContain('"f" is a file');
			expect(message).toContain('Next: move or remove the file at "f"');
		}
	});

	it.skipIf(process.getuid?.() === 0)(
		"names the blocked ancestor when a directory on the way to --config is mode 000",
		async () => {
			await mkdir(join(cwd, "nx"), { recursive: true });
			await chmod(join(cwd, "nx"), 0o000);
			try {
				try {
					await loadConfig(cwd, "nx/h.ts");
					throw new Error("expected loadConfig to throw");
				} catch (error) {
					expect(error).toMatchObject({ code: "config-unreadable" });
					const message = (error as { message: string }).message;
					expect(message).toContain("(EACCES)");
					expect(message).toContain('Next: check permissions on "nx"');
				}
			} finally {
				await chmod(join(cwd, "nx"), 0o755);
			}
		},
	);

	it("still surfaces config-load-failed for a present file with an unresolvable import (control)", async () => {
		await mkdir(join(cwd, "sub"), { recursive: true });
		await writeFile(
			join(cwd, "sub", "h.ts"),
			'import { nope } from "no-such-package";\nexport default { entry: [nope] };\n',
		);
		try {
			await loadConfig(cwd, "sub/h.ts");
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-load-failed" });
		}
	});
});

// #846 review B3: the --config value config-not-found's Next: echoes is
// the one the user typed, as typed -- relativization (D57) is for a
// path hejbro discovered on the machine, never for a path the user
// supplied back to them.
describe("loadConfig / config-not-found echoes --config as typed in Next: (#846 review B3)", () => {
	it.each([
		{
			label: "a relative value (control)",
			value: "sub/hejbro.config.ts",
			expected: "--config sub/hejbro.config.ts",
		},
		{
			label: "a leading ./ is kept",
			value: "./sub/hejbro.config.ts",
			expected: "--config ./sub/hejbro.config.ts",
		},
		{
			label: "an escaping ../ is kept",
			value: "../shared/hejbro.config.ts",
			expected: "--config ../shared/hejbro.config.ts",
		},
	])("echoes $label", async ({ value, expected }) => {
		const cwd = await mkdtemp(join(tmpdir(), "hejbro-loader-echo-"));
		try {
			await loadConfig(cwd, value);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain(`hejbro init ${expected}`);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("echoes an absolute --config value verbatim, from a shallow working directory", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "hejbro-loader-echo-abs-"));
		const absolutePath = "/abs/hejbro.config.ts";
		try {
			await loadConfig(cwd, absolutePath);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain(`hejbro init --config ${absolutePath}`);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("echoes an absolute --config value verbatim, from a working directory nested four levels deep", async () => {
		const base = await mkdtemp(join(tmpdir(), "hejbro-loader-echo-deep-"));
		const cwd = join(base, "a", "b", "c", "d");
		const absolutePath = "/abs/hejbro.config.ts";
		await mkdir(cwd, { recursive: true });
		try {
			await loadConfig(cwd, absolutePath);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain(`hejbro init --config ${absolutePath}`);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});

describe("loadDeclarations", () => {
	it("collects every exported hejbro declaration, ignoring non-declaration exports", async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations).toHaveLength(2);
		const [schemaInput, tableInput] = declarations;
		expect(schemaInput).toMatchObject({
			declarationKind: "schema",
			schemaName: "app",
		});
		// jiti loads fixtures through Node's native import(), while vitest
		// transforms this test file (and src/loader.ts) through its own SSR
		// module graph — a "@hejbro/core" imported in *this* file isn't
		// guaranteed to be the same module instance jiti's fixture resolved.
		// This is a real instance of the cross-instance-symbol case
		// (phase8-symbol-for, #138), not a synthetic one: before `tableMeta`
		// switched to `Symbol.for`, `isTable()` here was expected to
		// disagree across that boundary (that's why this assertion used to
		// check structurally instead). Asserted directly now to lock the
		// fix in — if it ever regresses, this goes red for the same reason
		// generate/verify's declaration collection would.
		expect(isTable(tableInput)).toBe(true);
		expect(tableInput).toMatchObject({
			id: { sqlName: "id" },
			title: { sqlName: "title" },
		});
	});

	it("throws entry-not-found with the owner-approved single-pattern text verbatim", async () => {
		const cwd = join(fixturesDir, "entry-not-found");
		const { config, configPath } = await loadConfig(cwd, undefined);
		try {
			await loadDeclarations(configPath, config);
			throw new Error("expected loadDeclarations to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "entry-not-found",
				message:
					'hejbro.config.ts\'s entry pattern "src/**/*.schema.ts" matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun `hejbro generate`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.',
			});
		}
	});

	it("uses the count-based plural 'entry patterns' phrasing for 2+ patterns", async () => {
		const cwd = join(fixturesDir, "entry-not-found");
		const { configPath } = await loadConfig(cwd, undefined);
		try {
			await loadDeclarations(configPath, {
				entry: ["src/a.schema.ts", "src/b.schema.ts"],
				migrationsDir: "migrations",
				snapshotPath: "hejbro.snapshot.json",
				prefixStrategy: "timestamp",
				presets: [],
			});
			throw new Error("expected loadDeclarations to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "entry-not-found",
				message:
					'hejbro.config.ts\'s entry patterns "src/a.schema.ts", "src/b.schema.ts" matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun `hejbro generate`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.',
			});
		}
	});

	it("orders declarations deterministically by sorted file path, not directory-listing order", async () => {
		const cwd = join(fixturesDir, "ordering");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations.map(schemaNameOf)).toEqual(["a_schema", "z_schema"]);
	});

	it("preserves the module export name for each table", async () => {
		const cwd = join(fixturesDir, "basic");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		const tableInput = declarations.find(isTable);
		expect(tableInput).toBeDefined();
		expect(declarations.exportNames.get(tableInput as HejbroInput)).toBe(
			"posts",
		);
		// still an ordinary array — the addition is additive, not a new shape.
		expect(Array.isArray(declarations)).toBe(true);
		expect(declarations).toHaveLength(2);
	});

	// Characterization pin, green on arrival (add-unmanaged-objects, 2.2):
	// group 1 already landed the loader-relevant half of this change --
	// `loadDeclarations` collects every `isTable()` export regardless of
	// managed/existing, so this scenario required no loader code change
	// at all. Load-bearing anyway (proven by mutant, not by red): see this
	// file's own `.filter` in `loadDeclarations` (`src/loader.ts`).
	it("an exported existing table is loaded as a declaration", async () => {
		const cwd = join(fixturesDir, "existing-table");
		const { config, configPath } = await loadConfig(cwd, undefined);
		const declarations = await loadDeclarations(configPath, config);
		expect(declarations).toHaveLength(1);
		const [authUsersInput] = declarations;
		expect(isTable(authUsersInput as HejbroInput)).toBe(true);
		expect(declarations.exportNames.get(authUsersInput as HejbroInput)).toBe(
			"authUsers",
		);
	});
});

// D106 round 1 N1: a typed `.`/`..` is the working directory (or its parent);
// the remedy must never be "remove the directory you are standing in".
describe("loadConfig / a --config value that names the working directory (D106 R1 N1)", () => {
	it.each([".", "./", ".."])(
		"refuses %s as config-not-a-file without asking to remove it",
		async (value) => {
			const base = await mkdtemp(join(tmpdir(), "hejbro-loader-dot-"));
			const cwd = join(base, "here");
			await mkdir(cwd, { recursive: true });
			try {
				await loadConfig(cwd, value);
				throw new Error("expected loadConfig to throw");
			} catch (error) {
				expect(error).toMatchObject({ code: "config-not-a-file" });
				const message = (error as { message: string }).message;
				expect(message).not.toContain("move or remove");
				expect(message).toContain("--config ./hejbro.config.ts");
			} finally {
				await rm(base, { recursive: true, force: true });
			}
		},
	);
});

// D106 round 1 N3: the echoed value must survive being pasted back into a shell.
describe("loadConfig / config-not-found quotes a --config value a shell would split (D106 R1 N3)", () => {
	it.each([
		{ value: "my dir/h.ts", expected: '--config "my dir/h.ts"' },
		{
			value: "sub/hejbro.config.ts",
			expected: "--config sub/hejbro.config.ts",
		},
		{ value: "odd$name/h.ts", expected: '--config "odd\\$name/h.ts"' },
	])("echoes $value as $expected", async ({ value, expected }) => {
		const cwd = await mkdtemp(join(tmpdir(), "hejbro-loader-quote-"));
		try {
			await loadConfig(cwd, value);
			throw new Error("expected loadConfig to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "config-not-found" });
			const message = (error as { message: string }).message;
			expect(message).toContain(`hejbro init ${expected}`);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
