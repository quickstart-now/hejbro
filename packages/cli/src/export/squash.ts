import type { HejbroInput, KindRegistry, Validator } from "@hejbro/core";
import { emptySnapshot, generateMigration } from "@hejbro/core";

/**
 * The squashed SQL for the export's `snapshot.sql` (schema-export spec,
 * "The export includes the SQL that raises the schema"): a full create
 * script is exactly what `generateMigration` already emits when it diffs
 * against nothing, so this reuses that same call rather than a second
 * SQL-rendering path — no banner (this isn't a migration file), no
 * renames or confirmed drops possible against an empty snapshot. Shared
 * by `generate` (which writes it) and `verify` (which recomputes it to
 * compare, R2-G3) — one function, so the two can never disagree about
 * what the squashed SQL for a given set of declarations is.
 */
export const buildSquashedSql = (
	declarations: ReadonlyArray<HejbroInput>,
	registry: KindRegistry,
	validators: ReadonlyArray<Validator>,
): string =>
	generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
		registry,
		validators,
	}).sql;
