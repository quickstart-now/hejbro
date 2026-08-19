import type { MigrationPrefixStrategy } from "@hejbro/core";
import { migrationPrefixStrategies, throwHejbroError } from "@hejbro/core";
import type { ZodIssue } from "zod";
import { z } from "zod";

/** The shape of `hejbro.config.ts` (decision D30). */
export type HejbroConfig = {
	readonly entry: ReadonlyArray<string>;
	readonly migrationsDir: string;
	readonly snapshotPath: string;
	readonly prefixStrategy: MigrationPrefixStrategy;
};

/** Identity helper so `hejbro.config.ts` reads as a declaration, not a cast. */
export const defineConfig = (config: HejbroConfig): HejbroConfig => config;

const configSchema = z.object({
	entry: z.array(z.string()),
	migrationsDir: z.string(),
	snapshotPath: z.string(),
	prefixStrategy: z.enum(migrationPrefixStrategies),
});

const HEJBRO_CONFIG_SHAPE_HINT =
	'{ entry: string[], migrationsDir: string, snapshotPath: string, prefixStrategy: "timestamp" | "index" | "unix" }';

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

/**
 * Validates an unknown loaded value (the default export of a
 * `hejbro.config.ts`) against {@link HejbroConfig}. zod issues are
 * re-wrapped into a `HejbroError` code `"invalid-config"` — zod's own
 * message text never reaches the user (owner condition, U3).
 */
export const parseConfig = (
	value: unknown,
	configPath: string,
): HejbroConfig => {
	const result = configSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	const message = result.error.issues
		.map((issue) => describeIssue(issue, configPath))
		.join(" ");
	return throwHejbroError("invalid-config", message);
};
