import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import { HejbroError, isTable, throwHejbroError } from "@hejbro/core";
import { createJiti } from "jiti";
import { glob } from "tinyglobby";
import type { HejbroConfig } from "./config";
import { parseConfig } from "./config";
import { normalizeEqualsFlags } from "./flags";
import { probePath } from "./path-probe";

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

/** A `catch` clause's `unknown` value's message, if it's an `Error`;
 * its `String(...)` form otherwise (e.g. a thrown string/plain object). */
const messageOfUnknownError = (error: unknown): string => {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
};

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
		const reason = firstLine(messageOfUnknownError(error));
		const { code, message } = toDiagnostic(reason);
		return throwHejbroError(code, message);
	}
};

const DEFAULT_CONFIG_FILE_NAME = "hejbro.config.ts";

/**
 * The `--config` value every command that accepts the flag shares (#846
 * D5): the last occurrence's value, after `--config=value` is normalized
 * to the space form. A trailing `--config` (no value follows) is `""` —
 * refused the same way an explicit `--config=` is, never silently
 * "flag absent" (NB8: that silent fallback used to resolve to the
 * working directory and then refuse it as an existing "directory").
 */
/** A `--config` value as it must be typed back into a shell: bare when it
 * carries only path-safe characters, double-quoted (with `"`, `\\`, `$` and
 * backtick escaped) otherwise — a pasted `Next:` must run as one argument
 * (D106 R1 N3). */
export const shellArgument = (value: string): string => {
	if (/^[A-Za-z0-9_./~:@=+,-]+$/.test(value)) {
		return value;
	}
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
};

export const configFlagFrom = (
	rawArgs: ReadonlyArray<string>,
): string | undefined => {
	const normalized = normalizeEqualsFlags(rawArgs);
	const lastIndex = normalized.lastIndexOf("--config");
	if (lastIndex === -1) {
		return undefined;
	}
	const value = normalized[lastIndex + 1];
	if (value === undefined) {
		return "";
	}
	return value;
};

/** `relative(cwd, path)`, `"./"` when that's empty (the resolved path is
 * `cwd` itself) — never a bare empty string in a message (D57-style
 * convention, shared by every configured-path label in this codebase). */
const relLabel = (cwd: string, path: string): string => {
	const rel = relative(cwd, path);
	if (rel === "") {
		return "./";
	}
	return rel;
};

/**
 * A message's "what happened" and "what to do" halves, kept apart so
 * every throw site composes its own literal `` `${reason} Next:
 * ${next}` `` (#846 review B4): `check:next-marker` scans a call site's
 * own text for a literal `Next:` and cannot follow a message through an
 * imported function, so a shared builder returning one already-joined
 * string reads as "no Next:" from a call site outside this file (as
 * `init.ts`'s own throws were). Composing the literal at each site,
 * same-file or not, is what makes the scanner's read of the invariant
 * match the message's own.
 */
type ConfigPathParts = {
	readonly reason: string;
	readonly next: string;
};

/**
 * The configuration path spelled as a directory (#846 D5, D2): a
 * directory or a dangling link where the configuration file belongs.
 * Exported so `init` throws the identical sentence under
 * `init-path-conflict` (#846 D5/D6) — the tail each site appends
 * (`"then rerun."` on the read side, `` "then rerun `hejbro init`." ``
 * for `init`'s own refusal) is the one difference.
 */
export const configNotAFileMessage = (
	rel: string,
	holder:
		| { readonly kind: "directory" }
		| { readonly kind: "dangling"; readonly target: string },
): ConfigPathParts => {
	if (holder.kind === "directory") {
		// A value that names the working directory or its parent (`.`, `./`,
		// `..`) must never be answered with "remove that directory" (D106 R1
		// N1): the remedy is the file the flag was meant to name.
		if (/^\.\.?\/?$/.test(rel)) {
			return {
				reason: `"${rel}" is the configuration path, but that is a directory — the configuration is a file hejbro reads.`,
				next: "pass the configuration file itself (--config ./hejbro.config.ts), or drop the flag to use ./hejbro.config.ts,",
			};
		}
		return {
			reason: `"${rel}" is the configuration path, but a directory is there — the configuration is a file hejbro reads.`,
			next: `move or remove the existing directory at "${rel}", or name another file with --config,`,
		};
	}
	return {
		reason: `"${rel}" is the configuration path, but a dangling symbolic link is there, pointing at "${holder.target}".`,
		next: "remove the link or create its target, or name another file with --config,",
	};
};

/**
 * The configuration path judged unreadable (#846 D5, D3 adapted): an
 * ancestor in the way, a blocked directory, or a path that could not
 * even be inspected. Exported for the same reason as
 * {@link configNotAFileMessage}.
 */
export const configUnreadableMessage = (
	rel: string,
	cause:
		| { readonly kind: "ancestor-file"; readonly culprit: string }
		| {
				readonly kind: "ancestor-dangling";
				readonly culprit: string;
				readonly target: string;
		  }
		| {
				readonly kind: "blocked";
				readonly culprit: string;
				readonly code: string;
		  }
		| {
				readonly kind: "stat-failed";
				readonly path: string;
				readonly code: string;
		  },
): ConfigPathParts => {
	if (cause.kind === "ancestor-file") {
		return {
			reason: `"${rel}" is the configuration path, but "${cause.culprit}" is a file and cannot hold it.`,
			next: `move or remove the file at "${cause.culprit}",`,
		};
	}
	if (cause.kind === "ancestor-dangling") {
		return {
			reason: `"${rel}" is the configuration path, but "${cause.culprit}" is a dangling symbolic link, pointing at "${cause.target}".`,
			next: "remove the link or create its target,",
		};
	}
	if (cause.kind === "blocked") {
		return {
			reason: `"${rel}" is the configuration path, but it could not be checked (${cause.code}): "${cause.culprit}" does not let this process look inside it.`,
			next: `check permissions on "${cause.culprit}",`,
		};
	}
	return {
		reason: `"${rel}" is the configuration path, but it could not be checked (${cause.code}).`,
		next: `check what "${cause.path}" points at,`,
	};
};

export const resolveConfigPath = (
	cwd: string,
	configFlag: string | undefined,
): string => {
	if (configFlag !== undefined && configFlag.trim() === "") {
		return throwHejbroError(
			"invalid-config-flag",
			'"--config" was given an empty value. Next: pass the configuration file\'s path (--config path/to/hejbro.config.ts), or drop the flag to use ./hejbro.config.ts.',
		);
	}
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
 * The path is judged the same way `init` judges every configured
 * artifact (`probePath`, #846 D2) before it is ever handed to jiti: a
 * directory or a dangling link is refused as `config-not-a-file`, an
 * ancestor in the way or an uninspectable path as `config-unreadable` —
 * never an import-resolution diagnostic about a path that was never a
 * file to begin with.
 */
export const loadConfig = async (
	cwd: string,
	configFlag: string | undefined,
): Promise<{ readonly config: HejbroConfig; readonly configPath: string }> => {
	const configPath = resolveConfigPath(cwd, configFlag);
	const outcome = probePath(cwd, configPath);
	if (outcome.kind === "absent") {
		if (configFlag === undefined) {
			return throwHejbroError(
				"config-not-found",
				"no hejbro.config.ts was found. Next: run `hejbro init` to scaffold hejbro.config.ts, a migrations directory, and an empty snapshot file, then add a declaration file and rerun `hejbro generate`.",
			);
		}
		const rel = relLabel(cwd, configPath);
		// #846 review B3: the --config value here is the one the user
		// typed, verbatim -- D57's "never an absolute path" rule protects
		// a path hejbro discovered on the machine, not a value handed
		// back to the person who supplied it. Everywhere else in this
		// sentence (the label above) stays cwd-relative like every other
		// report line.
		return throwHejbroError(
			"config-not-found",
			`no configuration file was found at "${rel}". Next: run \`hejbro init --config ${shellArgument(configFlag)}\` to scaffold it there, with a migrations directory and an empty snapshot file, then add a declaration file and rerun \`hejbro generate\`.`,
		);
	}
	if (outcome.kind === "present" && outcome.actualKind === "directory") {
		const { reason, next } = configNotAFileMessage(relLabel(cwd, configPath), {
			kind: "directory",
		});
		return throwHejbroError(
			"config-not-a-file",
			`${reason} Next: ${next} then rerun.`,
		);
	}
	if (outcome.kind === "dangling") {
		const { reason, next } = configNotAFileMessage(relLabel(cwd, configPath), {
			kind: "dangling",
			target: outcome.target,
		});
		return throwHejbroError(
			"config-not-a-file",
			`${reason} Next: ${next} then rerun.`,
		);
	}
	if (outcome.kind === "ancestor-file") {
		const { reason, next } = configUnreadableMessage(
			relLabel(cwd, configPath),
			{ kind: "ancestor-file", culprit: relative(cwd, outcome.path) },
		);
		return throwHejbroError(
			"config-unreadable",
			`${reason} Next: ${next} then rerun.`,
		);
	}
	if (outcome.kind === "ancestor-dangling") {
		const { reason, next } = configUnreadableMessage(
			relLabel(cwd, configPath),
			{
				kind: "ancestor-dangling",
				culprit: relative(cwd, outcome.path),
				target: outcome.target,
			},
		);
		return throwHejbroError(
			"config-unreadable",
			`${reason} Next: ${next} then rerun.`,
		);
	}
	if (outcome.kind === "blocked") {
		const { reason, next } = configUnreadableMessage(
			relLabel(cwd, configPath),
			{
				kind: "blocked",
				culprit: relative(cwd, outcome.culprit),
				code: outcome.code,
			},
		);
		return throwHejbroError(
			"config-unreadable",
			`${reason} Next: ${next} then rerun.`,
		);
	}
	if (outcome.kind === "stat-failed") {
		const { reason, next } = configUnreadableMessage(
			relLabel(cwd, configPath),
			{
				kind: "stat-failed",
				path: relative(cwd, outcome.path),
				code: outcome.code,
			},
		);
		return throwHejbroError(
			"config-unreadable",
			`${reason} Next: ${next} then rerun.`,
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

/**
 * Whether a loaded module is a vendored contract (schema-vendoring
 * spec, "Generating from a vendored contract is refused") — judged by
 * the one export every contract this tool ever writes always carries
 * (`contract/emit.ts`'s `contractMetadata`), never by the file's own
 * name or path (planner-confirmed): a signal a project could rename or
 * relocate would make the refusal easy to defeat by accident, where the
 * export's own presence cannot be. `contractMetadata` itself carries no
 * `declarationKind`, so it was already silently excluded from
 * `collectDeclarations` before this check existed — this check runs
 * first specifically so the refusal names *why* nothing was found,
 * instead of falling through to the generic `entry-not-found`/"exports
 * nothing" diagnostics, neither of which mentions a contract at all.
 */
const hasContractMetadataExport = (moduleNamespace: unknown): boolean =>
	typeof moduleNamespace === "object" &&
	moduleNamespace !== null &&
	"contractMetadata" in moduleNamespace;

/** Refuses `filePath` as a declaration entry point, naming the repository that owns the schema — mirrors the wording the migration-authority refusal already used for the same idea (`engine/generate.ts`'s `synced-table-declared`), applied here to the file level rather than one table's own value. */
const refuseVendoredContractAsEntry = (filePath: string | undefined): never =>
	throwHejbroError(
		"vendored-contract-declared",
		`"${filePath ?? "(unknown file)"}" is a vendored contract (hejbro vendor wrote it) — it carries no declarations, only types and metadata for reading and writing through what's already there. Next: declare the schema with table() in the repository that owns it, or remove this file from hejbro.config.ts's entry patterns if it was matched by accident.`,
	);

/** A module's declarations, paired with the export name each was found
 * under — the map's key is the declaration's own identity, so a
 * declaration exported under no name (there is none for a plain module
 * export, but a caller may synthesize one, e.g. a trigger's function)
 * simply has no entry. */
const collectDeclarations = (
	moduleNamespace: object,
): {
	readonly declarations: ReadonlyArray<HejbroInput>;
	readonly exportNames: ReadonlyMap<HejbroInput, string>;
} => {
	const named = Object.entries(moduleNamespace).filter(
		(entry): entry is [string, HejbroInput] => isHejbroInput(entry[1]),
	);
	return {
		declarations: named.map(([, value]) => value),
		exportNames: new Map(named.map(([name, value]) => [value, name])),
	};
};

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

/** The array `loadDeclarations` has always returned, carrying an
 * additional `exportNames` map keyed by declaration identity (3.1) — a
 * plain array in every other respect, so every caller that only ever
 * iterated or indexed it is untouched by this addition. */
export type LoadedDeclarations = ReadonlyArray<HejbroInput> & {
	readonly exportNames: ReadonlyMap<HejbroInput, string>;
};

/**
 * Glob-expands `config.entry` relative to the config file's directory
 * (deterministic — matches sorted by path, independent of directory
 * listing order), jiti-imports every matched file, and collects every
 * exported value that is a hejbro declaration (`isTable`/`declarationKind`
 * narrowing) — non-declaration exports are silently ignored. The returned
 * array also carries `exportNames`, the module export name each
 * declaration was found under (3.1) — needed downstream by the schema
 * export, which carries a table or function's export name because a
 * consuming repository's relation keys and typed function calls are keyed
 * by it.
 */
export const loadDeclarations = async (
	configPath: string,
	config: HejbroConfig,
): Promise<LoadedDeclarations> => {
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
	const vendoredContractIndex = modules.findIndex(hasContractMetadataExport);
	if (vendoredContractIndex !== -1) {
		refuseVendoredContractAsEntry(sortedMatches[vendoredContractIndex]);
	}
	const collected = modules.map((moduleNamespace) =>
		collectDeclarations(moduleNamespace as object),
	);
	const declarations = collected.flatMap((entry) => entry.declarations);
	const exportNames = new Map(
		collected.flatMap((entry) => Array.from(entry.exportNames.entries())),
	);
	return Object.assign([...declarations], { exportNames });
};
