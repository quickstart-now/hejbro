import { isAbsolute } from "node:path";
import type { MigrationPrefixStrategy, Preset } from "@hejbro/core";
import { migrationPrefixStrategies, throwHejbroError } from "@hejbro/core";
import type { ZodIssue } from "zod";
import { z } from "zod";

/**
 * The shape of `hejbro.config.ts` (decision D30). `migrationsDir`,
 * `snapshotPath` and `prefixStrategy` serve only a repository that holds
 * migration authority and are optional (cli-commands delta,
 * "Configuration asks each command only for what it needs") — `entry` is
 * not relaxed alongside them: every repository still reads declarations,
 * migration-authoring or not. A command that needs one of the three and
 * finds it absent refuses by name (`config-required.ts`) before doing
 * any work, rather than failing however this field's absence happens to
 * surface deeper in that command's own logic.
 */
export type HejbroConfig = {
	readonly entry: ReadonlyArray<string>;
	readonly migrationsDir?: string;
	readonly snapshotPath?: string;
	readonly prefixStrategy?: MigrationPrefixStrategy;
	/** Provider presets to register — their kinds and validators (D55). Defaults to `[]`. */
	readonly presets: ReadonlyArray<Preset>;
};

/** Identity helper so `hejbro.config.ts` reads as a declaration, not a cast. */
export const defineConfig = (config: HejbroConfig): HejbroConfig => config;

const isFunctionValue = (value: unknown): boolean =>
	typeof value === "function";

/** Shape-checks an unknown `presets[i].kinds[j]` entry against `ObjectKind`'s public methods — not a deep validation of each method's behavior, just "looks like a kind". */
const isObjectKindLike = (value: unknown): boolean => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.kind === "string" &&
		isFunctionValue(candidate.owns) &&
		isFunctionValue(candidate.serialize) &&
		isFunctionValue(candidate.identify) &&
		isFunctionValue(candidate.diff) &&
		isFunctionValue(candidate.emit)
	);
};

/** Shape-checks an unknown `presets[i]` entry against {@link Preset} (`name` string, `kinds` array of kind-like objects, `validators` array of functions). */
export const isPreset = (value: unknown): value is Preset => {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.name !== "string") {
		return false;
	}
	if (
		!Array.isArray(candidate.kinds) ||
		!candidate.kinds.every(isObjectKindLike)
	) {
		return false;
	}
	if (
		!Array.isArray(candidate.validators) ||
		!candidate.validators.every(isFunctionValue)
	) {
		return false;
	}
	return true;
};

const configSchema = z.object({
	entry: z.array(z.string()),
	migrationsDir: z.string().optional(),
	snapshotPath: z.string().optional(),
	prefixStrategy: z.enum(migrationPrefixStrategies).optional(),
	presets: z.array(z.unknown()).default([]),
});

const HEJBRO_CONFIG_SHAPE_HINT =
	'{ entry: string[], migrationsDir?: string, snapshotPath?: string, prefixStrategy?: "timestamp" | "index" | "unix", presets?: Preset[] }';

const issueFieldName = (issue: ZodIssue): string => {
	if (issue.path.length === 0) {
		return "(config root)";
	}
	return issue.path.map((segment) => String(segment)).join(".");
};

/**
 * Describes one zod issue in spec §7 style (why + what to do) — never
 * zod's own `message`/`code`/error-class text, per owner condition U3.
 */
const describeIssue = (issue: ZodIssue, configPath: string): string => {
	const field = issueFieldName(issue);
	if (issue.code === "invalid_value") {
		const options = issue.values
			.map((value) => `"${String(value)}"`)
			.join(", ");
		return `config field "${field}" in ${configPath} is invalid — expected one of ${options}. Next: fix "${field}" to one of the listed values.`;
	}
	return `config field "${field}" in ${configPath} is missing or the wrong shape. Next: match hejbro.config.ts's export to ${HEJBRO_CONFIG_SHAPE_HINT}.`;
};

/** The index of the first `presets[i]` entry that doesn't look like a `Preset`, or `null` when every entry does. */
const findInvalidPresetIndex = (
	presets: ReadonlyArray<unknown>,
): number | null => {
	const index = presets.findIndex((preset) => !isPreset(preset));
	if (index === -1) {
		return null;
	}
	return index;
};

const CONFIGURED_PATH_FIELDS = ["migrationsDir", "snapshotPath"] as const;

type ConfiguredPathField = (typeof CONFIGURED_PATH_FIELDS)[number];

/** The leading run of `/` stripped from `value` -- the relative spelling `Next:` suggests as a fix. */
const stripLeadingSeparators = (value: string): string =>
	value.replace(/^\/+/, "");

/** `migrationsDir`/`snapshotPath`, in field order, paired with their value where one is set and spelled absolute -- `[]` when neither is. */
const absolutePathFields = (data: {
	readonly migrationsDir?: string | undefined;
	readonly snapshotPath?: string | undefined;
}): ReadonlyArray<{
	readonly field: ConfiguredPathField;
	readonly value: string;
}> =>
	CONFIGURED_PATH_FIELDS.flatMap((field) => {
		const value = data[field];
		if (value === undefined || !isAbsolute(value)) {
			return [];
		}
		return [{ field, value }];
	});

/** Whether `value` names a directory rather than a file: empty, a
 * trailing separator, or a last segment of "." or ".." — every spelling
 * that resolves to a directory node no file can ever be written to or
 * read from (#846 NB2/NB6, D1). */
const isSpelledAsDirectory = (value: string): boolean => {
	if (value === "" || value.endsWith("/")) {
		return true;
	}
	const lastSegment = value.split("/").at(-1);
	return lastSegment === "." || lastSegment === "..";
};

/** A `snapshotPath` spelled as a directory (#846 NB2/NB6, D1): refusing
 * once, when the configuration is read, is what keeps `init` and the
 * commands that read the snapshot from answering the same value two
 * ways — one refusing the spelling, the other stripping it, stat'ing the
 * file underneath, and reporting a permissions failure that was never
 * about permissions. Three shapes, three sentences (lead-approved,
 * design D1): an empty value never echoes a bare `""` back (regression,
 * `1bc19b32`) -- it names the field as empty instead; a trailing
 * separator suggests dropping it; a last segment of "." or ".."
 * (non-empty, no trailing separator) echoes the value but has no
 * separator to drop, so it only suggests the default file name. */
const describeSnapshotPathAsDirectory = (value: string): string => {
	if (value === "") {
		return `config field "snapshotPath" is empty, but the snapshot is a file. Next: point snapshotPath at a file path (e.g. "hejbro.snapshot.json"), or remove the field.`;
	}
	if (value.endsWith("/")) {
		return `config field "snapshotPath" names a directory ("${value}"), but the snapshot is a file. Next: point snapshotPath at a file path (e.g. "state.json") — drop the trailing "/" or name a file inside the directory.`;
	}
	return `config field "snapshotPath" names a directory ("${value}"), but the snapshot is a file. Next: point snapshotPath at a file path (e.g. "hejbro.snapshot.json").`;
};

/** `join(cwd, value)` silently swallows a leading "/", so an absolute-
 * looking `migrationsDir`/`snapshotPath` used to resolve under the
 * working directory anyway, with only the display differing between
 * commands (#743) -- `verify` even embeds the spelling in a shell
 * command, where it resolves at the filesystem root. Refusing is the
 * only honest answer: silently re-rooting the value keeps the
 * disagreement, just earlier. No `configPath` here (#745 owns that
 * text). */
const describeAbsolutePathField = (
	field: ConfiguredPathField,
	value: string,
): string =>
	`config field "${field}" is an absolute path ("${value}"), but hejbro resolves it relative to the working directory. Next: drop the leading "/" (e.g. "${stripLeadingSeparators(value)}") so the path names a location under the project.`;

/**
 * Validates an unknown loaded value (the default export of a
 * `hejbro.config.ts`) against {@link HejbroConfig}. zod issues are
 * re-wrapped into a `HejbroError` code `"invalid-config"` — zod's own
 * message text never reaches the user (owner condition, U3). `presets`
 * entries are shape-checked separately (zod only confirms "an array"; the
 * per-entry `Preset` shape check runs after, so its error names the exact
 * index).
 */
export const parseConfig = (
	value: unknown,
	configPath: string,
): HejbroConfig => {
	const result = configSchema.safeParse(value);
	if (!result.success) {
		const message = result.error.issues
			.map((issue) => describeIssue(issue, configPath))
			.join(" ");
		return throwHejbroError("invalid-config", message);
	}
	const offendingPath = absolutePathFields(result.data)[0];
	if (offendingPath !== undefined) {
		return throwHejbroError(
			"invalid-config",
			describeAbsolutePathField(offendingPath.field, offendingPath.value),
		);
	}
	if (
		result.data.snapshotPath !== undefined &&
		isSpelledAsDirectory(result.data.snapshotPath)
	) {
		return throwHejbroError(
			"invalid-config",
			describeSnapshotPathAsDirectory(result.data.snapshotPath),
		);
	}
	const invalidPresetIndex = findInvalidPresetIndex(result.data.presets);
	if (invalidPresetIndex !== null) {
		return throwHejbroError(
			"invalid-config",
			`config field "presets[${invalidPresetIndex}]" in ${configPath} is not a preset object. Next: pass preset objects exported by a preset package (e.g. supabasePreset from @hejbro/supabase).`,
		);
	}
	// findInvalidPresetIndex already confirmed every entry passes isPreset;
	// filter (rather than an `as` cast) lets the type predicate narrow the
	// array for us. The three optional fields are spread only when zod
	// actually parsed a value for them — under `exactOptionalPropertyTypes`,
	// an omitted key and a key explicitly set to `undefined` are different
	// types, and only the former matches `HejbroConfig`'s own optional
	// fields.
	return {
		entry: result.data.entry,
		...(result.data.migrationsDir !== undefined && {
			migrationsDir: result.data.migrationsDir,
		}),
		...(result.data.snapshotPath !== undefined && {
			snapshotPath: result.data.snapshotPath,
		}),
		...(result.data.prefixStrategy !== undefined && {
			prefixStrategy: result.data.prefixStrategy,
		}),
		presets: result.data.presets.filter(isPreset),
	};
};
