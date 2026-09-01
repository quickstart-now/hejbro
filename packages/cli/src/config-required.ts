import { throwHejbroError } from "@hejbro/core";
import type { HejbroConfig } from "./config";

/** The three fields `HejbroConfig` relaxed to optional (cli-commands
 * delta) — the only ones a command can be missing and need to refuse
 * for. */
type OptionalConfigField = "migrationsDir" | "snapshotPath" | "prefixStrategy";

/** Every CLI command that can reach this guard — `baseline` is its own
 * citty subcommand (`runGenerate` in `"baseline"` mode), so it gets its
 * own label rather than reading as `generate` in a refusal it didn't
 * cause. */
export type ConfigCommand =
	| "generate"
	| "baseline"
	| "verify"
	| "history"
	| "restore"
	| "check";

/**
 * Refuses with a coded error naming the first missing field a command
 * needs, before that command does any other work (cli-commands delta,
 * "Configuration asks each command only for what it needs"). Reuses
 * `invalid-config` rather than minting a new code: the repository's
 * existing habit (`config.ts`'s `describeIssue`) is one code for "this
 * config doesn't support what's being asked of it," with the field
 * named in the message, not the code — a per-command, per-field failure
 * is the same category of problem surfacing one step later (once a
 * command is known), not a new one, and six commands times three fields
 * would otherwise mint eighteen near-duplicate codes for it. Written as
 * a `asserts` function so the one call narrows every field it checks to
 * `string` (or `MigrationPrefixStrategy`) for the rest of the caller's
 * function body — no `!`, no repeated narrowing at each use site.
 */
export function requireConfigFields<
	TFields extends ReadonlyArray<OptionalConfigField>,
>(
	config: HejbroConfig,
	command: ConfigCommand,
	fields: TFields,
): asserts config is HejbroConfig & {
	readonly [K in TFields[number]]-?: NonNullable<HejbroConfig[K]>;
} {
	const missing = fields.find((field) => config[field] === undefined);
	if (missing !== undefined) {
		throwHejbroError(
			"invalid-config",
			`hejbro ${command} needs "${missing}" in hejbro.config.ts, which this configuration omits. Next: add "${missing}" to hejbro.config.ts, or run ${command} in the repository that owns the schema.`,
		);
	}
}
