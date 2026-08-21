import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { HejbroError, isTable, throwHejbroError } from "@hejbro/core";
import { createJiti } from "jiti";
import { glob } from "tinyglobby";
import type { HejbroConfig } from "./config";
import { parseConfig } from "./config";

/** First line only — a Node error's `.message` can carry a trailing
 * "Require stack:" block, and `Diagnostic.body`'s indentation assumes one
 * line per entry (§7 grammar). */
const firstLine = (message: string): string =>
	message.split("\n")[0] ?? message;

/** `base`, resolved — macOS's `/tmp` → `/private/tmp` symlink means a raw
 * Node error could in principle embed the *resolved* path even when
 * `base` itself is the unresolved one, which stripping only `base` would
 * miss. Kept defensively; not observed in the current tests (every
 * MODULE_NOT_FOUND message seen so far already carries the unresolved
 * form, so `base` alone strips it) — this covers a jiti/Node resolution
 * path this repo hasn't hit yet. Falls back to `base` unchanged if it
 * doesn't exist (nothing to resolve). */
const safeRealpath = (base: string): string => {
	try {
		return realpathSync(base);
	} catch {
		return base;
	}
};

/** Removes every `${base}/` (and its resolved-symlink equivalent) prefix
 * from `text` — a Node module-resolution error can embed an absolute path
 * built from `base` (e.g. `.../node_modules/<pkg>/dist/index.js`), and the
 * CLI never puts an absolute path in its own output (Task 14). Leaves the
 * informative suffix (package name, sub-path) intact. */
const stripAbsolutePrefixes = (text: string, base: string): string =>
	[base, safeRealpath(base)].reduce(
		(withoutPrefix, prefix) => withoutPrefix.split(`${prefix}/`).join(""),
		text,
	);

/**
 * Runs a jiti import and converts any failure into a `<code>-load-failed`
 * HejbroError — except a `HejbroError` itself, which passes through
 * unchanged. A declaration file's own DSL validation errors (e.g.
 * `schema("Bad Name")`) are thrown *during* `jiti.import`'s module
 * evaluation, not by the import mechanism — wrapping those too would lose
 * their real code and `declaredAt` and misreport them as a load failure
 * (phase8-loader-diagnostics item 12; #146 is what makes this `instanceof`
 * check reliable). Shared by `loadConfig` and `loadDeclarations` so a
 * third load site added later picks up the same handling automatically.
 */
const importOrDiagnose = async <T>(
	run: () => Promise<T>,
	toDiagnostic: (reason: string) => {
		readonly code: string;
		readonly message: string;
	},
): Promise<T> => {
	try {
		return await run();
	} catch (error) {
		if (error instanceof HejbroError) {
			throw error;
		}
		const reason = firstLine(
			error instanceof Error ? error.message : String(error),
		);
		const { code, message } = toDiagnostic(reason);
		return throwHejbroError(code, message);
	}
};

const DEFAULT_CONFIG_FILE_NAME = "hejbro.config.ts";

const resolveConfigPath = (
	cwd: string,
	configFlag: string | undefined,
): string => {
	if (configFlag === undefined) {
		return join(cwd, DEFAULT_CONFIG_FILE_NAME);
	}
	if (isAbsolute(configFlag)) {
		return configFlag;
	}
	return resolve(cwd, configFlag);
};

/**
 * Locates and loads `hejbro.config.ts` (or `--config <path>`, resolved
 * relative to `cwd`) via jiti's `import(id, { default: true })`, then
 * validates the loaded value against {@link HejbroConfig} (Task 9). jiti
 * is the one loader path for both config and declaration entries (U1/U2,
 * decisions D29/D30) — this also exercises the self-import cycle a real
 * `hejbro.config.ts` relies on (`import { defineConfig } from "hejbro"`).
 */
export const loadConfig = async (
	cwd: string,
	configFlag: string | undefined,
): Promise<{ readonly config: HejbroConfig; readonly configPath: string }> => {
	const configPath = resolveConfigPath(cwd, configFlag);
	if (!existsSync(configPath)) {
		return throwHejbroError(
			"config-not-found",
			"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
		);
	}
	// #102: disabled as a precaution — the cache buys nothing for a
	// handful of files; the reproduced failure was an external deletion of
	// dist/ during a run, not the cache.
	const jiti = createJiti(configPath, { fsCache: false });
	const loaded = await importOrDiagnose(
		() => jiti.import(configPath, { default: true }),
		(reason) => ({
			code: "config-load-failed",
			message: `failed to load "${relative(cwd, configPath)}": ${stripAbsolutePrefixes(reason, cwd)}. Next: check that every import in hejbro.config.ts resolves — a package that isn't installed, or an installed package whose "exports" field doesn't resolve, both surface here. Install it, or check the package's own "exports" if it's already installed.`,
		}),
	);
	const config = parseConfig(loaded, configPath);
	return { config, configPath };
};

/**
 * `Table`'s hidden metadata lived behind a per-module-instance `Symbol()`
 * (D15, `dsl/table.ts`'s `tableMeta`) — `isTable()` used to compare
 * against *this* `@hejbro/core` instance's symbol only, which silently
 * failed for a declaration file that resolved a *different* `@hejbro/core`
 * copy (e.g. a nested duplicate install, or a test runner's own module
 * graph running jiti-loaded code and this file through two different
 * loaders). `tableMeta` now uses `Symbol.for` (phase8-symbol-for, #138),
 * which is identical across module instances by construction, so
 * `isTable()` alone is cross-instance-safe and the description-matching
 * fallback that used to sit here is no longer needed — measured, not
 * assumed: removing it here still passes `loader.test.ts`'s
 * "collects every exported hejbro declaration" case, which is a *real*
 * instance of this exact split (jiti's native `import()` vs. vitest's own
 * SSR module graph), not a synthetic one.
 */
const isHejbroInput = (value: unknown): value is HejbroInput => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	if (isTable(value)) {
		return true;
	}
	return (
		typeof (value as { declarationKind?: unknown }).declarationKind === "string"
	);
};

const collectDeclarations = (
	moduleNamespace: object,
): ReadonlyArray<HejbroInput> =>
	Object.values(moduleNamespace).filter((value): value is HejbroInput =>
		isHejbroInput(value),
	);

/**
 * The onboarding example a terminal renderer attaches as a separate block
 * below the `entry-not-found` flat message (Task 13/14 — the flat message
 * itself never embeds this, per the owner-approved text).
 */
export const ONBOARDING_EXAMPLE = `import { schema, table, uuid, text } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
`;

/**
 * `"entry pattern \"a\""` for one pattern, `"entry patterns \"a\", \"b\""`
 * for more — the count-based singular/plural convention the owner already
 * approved for batch summary lines (decision ③), applied here too.
 */
const entryPatternPhrase = (entry: ReadonlyArray<string>): string => {
	const quoted = entry.map((pattern) => `"${pattern}"`).join(", ");
	if (entry.length === 1) {
		return `entry pattern ${quoted}`;
	}
	return `entry patterns ${quoted}`;
};

/**
 * Glob-expands `config.entry` relative to the config file's directory
 * (deterministic — matches sorted by path, independent of directory
 * listing order), jiti-imports every matched file, and collects every
 * exported value that is a hejbro declaration (`isTable`/`declarationKind`
 * narrowing) — non-declaration exports are silently ignored.
 */
export const loadDeclarations = async (
	configPath: string,
	config: HejbroConfig,
): Promise<ReadonlyArray<HejbroInput>> => {
	const entryDir = dirname(configPath);
	const matches = await glob([...config.entry], {
		cwd: entryDir,
		absolute: true,
	});
	const sortedMatches = [...new Set(matches)].sort();
	if (sortedMatches.length === 0) {
		return throwHejbroError(
			"entry-not-found",
			`hejbro.config.ts's ${entryPatternPhrase(config.entry)} matched 0 files. Next: if this is a new project, create a declaration file (see the example below) and rerun \`hejbro generate\`; if you already have declarations, check the "entry" pattern in hejbro.config.ts for a typo.`,
		);
	}
	// #102: disabled as a precaution — the cache buys nothing for a
	// handful of files; the reproduced failure was an external deletion of
	// dist/ during a run, not the cache.
	const jiti = createJiti(configPath, { fsCache: false });
	// Promise.all, not allSettled: only the first failing file is reported,
	// matching every other loader precondition (config-not-found,
	// entry-not-found) — one throw, not a batch. Collecting every failing
	// file would need a different return shape (a batch of errors instead
	// of a declaration array) threaded through generate/verify's own
	// batching, which is a larger redesign than "stop crashing raw" calls
	// for; a user fixes the first reported file and reruns, same as they
	// already do for every other precondition here.
	const modules = await Promise.all(
		sortedMatches.map((filePath) =>
			importOrDiagnose(
				() => jiti.import(filePath),
				(reason) => ({
					code: "declaration-load-failed",
					message: `failed to load "${relative(entryDir, filePath)}": ${stripAbsolutePrefixes(reason, entryDir)}. Next: check that every import in this file resolves — a package that isn't installed, or an installed package whose "exports" field doesn't resolve, both surface here. Install it, or check the package's own "exports" if it's already installed.`,
				}),
			),
		),
	);
	return modules.flatMap((moduleNamespace) =>
		collectDeclarations(moduleNamespace as object),
	);
};
