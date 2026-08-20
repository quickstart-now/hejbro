import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { isTable, throwHejbroError } from "@hejbro/core";
import { createJiti } from "jiti";
import { glob } from "tinyglobby";
import type { HejbroConfig } from "./config";
import { parseConfig } from "./config";

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
	const loaded = await jiti.import(configPath, { default: true });
	const config = parseConfig(loaded, configPath);
	return { config, configPath };
};

/**
 * `Table`'s hidden metadata lives behind a per-module-instance `Symbol()`
 * (D15, `dsl/table.ts`'s `tableMeta`). `isTable()` compares against *this*
 * `@hejbro/core` instance's symbol — correct for the normal case (one
 * deduped `@hejbro/core` across the loader and every jiti-loaded file).
 * Matching by the symbol's `description` instead is a cross-instance-safe
 * fallback for the rare case a declaration file resolves a *different*
 * `@hejbro/core` copy (e.g. a nested duplicate install, or a test runner's
 * own module graph running jiti-loaded code and this file through two
 * different loaders) — `isTable` alone would silently drop the table.
 */
const hasTableMetaSymbol = (value: object): boolean =>
	Object.getOwnPropertySymbols(value).some(
		(symbol) => symbol.description === "hejbro:table-meta",
	);

const isHejbroInput = (value: unknown): value is HejbroInput => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	if (isTable(value) || hasTableMetaSymbol(value)) {
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
	const modules = await Promise.all(
		sortedMatches.map((filePath) => jiti.import(filePath)),
	);
	return modules.flatMap((moduleNamespace) =>
		collectDeclarations(moduleNamespace as object),
	);
};
