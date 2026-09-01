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
