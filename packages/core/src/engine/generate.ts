import type { TriggerDeclaration } from "../dsl/define-trigger";
import type { GrantSetDeclaration } from "../dsl/grant";
import type { Table, TableDeclaration } from "../dsl/table";
import { getTableMeta, isTable } from "../dsl/table";
import type { HejbroError } from "../error";
import { hejbroError, throwHejbroError } from "../error";
import type { HejbroDeclaration, KindChange } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { createDefaultRegistry } from "../kind/registry";
import type { SequenceDeclaration } from "../kinds/sequence-kind";
import { deriveSequenceName } from "../kinds/table-kind";
import { tableIdentity } from "../kinds/table-snapshot";
import type { Snapshot } from "../snapshot/snapshot";
import { buildSnapshot } from "../snapshot/snapshot";
import { compareKeys } from "../sort";
import type { BannerHashes } from "../sql/migration-file";
import { renderBanner } from "../sql/migration-file";
import type { SqlStatement } from "../sql/statement";
import { isSerialTypeNode, serialSequenceBaseType } from "../types/type-node";
import {
	notNullWithoutDefaultWarnings,
	rlsUnreachableSchemaWarnings,
} from "./core-validators";
import { diffSnapshots, rankKinds } from "./diff-engine";
import type {
	ConfirmDropSpec,
	RenameAmbiguity,
	RenameSpec,
} from "./rename-plan";
import { planRenames } from "./rename-plan";
import type { Diagnostic, Validator } from "./validate";
import { runValidators } from "./validate";

/** Anything `generateMigration` accepts as a declaration: a plain declaration, or a `table()`-built `Table` object (unwrapped via `getTableMeta` at the entry point). */
export type HejbroInput = HejbroDeclaration | Table;

const isTriggerDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TriggerDeclaration =>
	declaration.declarationKind === "trigger";

const isGrantSetDeclaration = (
	declaration: HejbroDeclaration,
): declaration is GrantSetDeclaration =>
	declaration.declarationKind === "grant-set";

/**
 * Synthesizes one `SequenceDeclaration` per `serial`/`smallserial`/
 * `bigserial` column on `meta` (#23/D66) — there is no `defineSequence()`
 * in the public DSL; a serial-family column's backing sequence is always
 * derived from the table declaration itself, the same way `rls`/`policy`
 * declarations below are derived from a table's own `rls` field.
 */
const synthesizeSequenceDeclarations = (
	meta: TableDeclaration,
): ReadonlyArray<SequenceDeclaration> =>
	meta.columns.flatMap((column) => {
		if (!isSerialTypeNode(column.columnState.typeNode)) {
			return [];
		}
		const typeName = column.columnState.typeNode.typeName;
		return [
			{
				declarationKind: "sequence",
				schema: meta.schema,
				sequenceName: deriveSequenceName(meta.tableName, column.columnName),
				tableName: meta.tableName,
				columnName: column.columnName,
				baseType: serialSequenceBaseType(typeName),
			},
		];
	});

/**
 * Resolves one `HejbroInput` into the declaration(s) it contributes to the
 * snapshot. A `defineTrigger` declaration expands into its own function
 * declaration plus itself — `[functionDeclaration, triggerDeclaration]` —
 * so the function it creates lands in the snapshot without a separate
 * `defineFunction` call. A `grant(...).to(...)` `grant-set` expands into
 * its per-role `GrantDeclaration`s (D28 fan-out). A `table()` with any
 * `serial`-family columns similarly expands into one `SequenceDeclaration`
 * per such column (#23/D66).
 */
const resolveDeclarations = (
	input: HejbroInput,
): ReadonlyArray<HejbroDeclaration> => {
	if (isTable(input)) {
		const meta = getTableMeta(input);
		if (meta.existing) {
			return throwHejbroError(
				"existing-table-declared",
				`existingTable("${meta.schema.schemaName}", "${meta.tableName}") is reference-only — it describes an existing table and must not be passed to generateMigration. Next: remove it from the declarations list (managed tables are declared with table()).`,
				meta.declaredAt,
			);
		}
		const sequences = synthesizeSequenceDeclarations(meta);
		if (meta.rls === null) {
			return [meta, ...sequences];
		}
		return [meta, ...sequences, meta.rls, ...meta.rls.policies];
	}
	if (isTriggerDeclaration(input)) {
		return [input.functionDeclaration, input];
	}
	if (isGrantSetDeclaration(input)) {
		return input.grants;
	}
	return [input];
};

type GenerateMigrationOptions = {
	readonly declarations: ReadonlyArray<HejbroInput>;
	readonly previousSnapshot: Snapshot;
	readonly registry?: KindRegistry;
	/** `--rename` flags, parsed into pure data (decision D32, rule A). */
	readonly renames?: ReadonlyArray<RenameSpec>;
	/** `--confirm-drop` flags, parsed into pure data (decision D32, rule A). */
	readonly confirmedDrops?: ReadonlyArray<ConfirmDropSpec>;
	/** the banner's tamper-evident hash-chain lines (D33) — opaque `"sha256:<hex>"` strings the CLI computes; core never hashes. */
	readonly bannerHashes?: BannerHashes;
	/** preset-supplied pure checks run over the built snapshot + normalized declarations (D37); error severity joins `errors` and short-circuits like rename errors. */
	readonly validators?: ReadonlyArray<Validator>;
};

type GenerateMigrationResult = {
	readonly snapshot: Snapshot;
	readonly changes: ReadonlyArray<KindChange>;
	readonly sql: string;
	readonly hasChanges: boolean;
	/** rename/confirm-drop diagnostics (decision D32) plus error-severity validator diagnostics (D37); non-empty ⇒ `sql === ""`, `hasChanges === false`, nothing writable. */
	readonly errors: ReadonlyArray<HejbroError>;
	/** the `ambiguous-*` subset of `errors`, structured (1:1, same order) — see {@link RenameAmbiguity}. */
	readonly ambiguities: ReadonlyArray<RenameAmbiguity>;
	/** warning-severity validator diagnostics (D37); empty when `validators` is omitted. */
	readonly warnings: ReadonlyArray<Diagnostic>;
};

/**
 * Builds the `declaredAt`-by-table-identity map `planRenames` attaches to
 * its diagnostics, from the *pre-normalization* `declarations` — after
 * `resolveDeclarations` a table's `declaredAt` would already be buried
 * inside its expanded RLS/policy declarations, so this reads it from each
 * `HejbroInput` directly (a `Table` via `getTableMeta`, or a plain
 * `TableDeclaration` as-is).
 */
const buildDeclaredAtByIdentity = (
	declarations: ReadonlyArray<HejbroInput>,
): ReadonlyMap<string, string | null> => {
	const entries = declarations.flatMap((input) => {
		if (isTable(input)) {
			const meta = getTableMeta(input);
			return [
				[
					tableIdentity(meta.schema.schemaName, meta.tableName),
					meta.declaredAt,
				] as const,
			];
		}
		if (input.declarationKind === "table") {
			const declaration = input as TableDeclaration;
			return [
				[
					tableIdentity(declaration.schema.schemaName, declaration.tableName),
					declaration.declaredAt,
				] as const,
			];
		}
		return [];
	});
	return new Map(entries);
};

/**
 * Runs the full pipeline: build the next snapshot from `declarations`,
 * resolve `renames`/`confirmedDrops` against `previousSnapshot` (rule A;
 * `errors` non-empty short-circuits with `sql: ""`), diff the rewritten
 * previous snapshot against the next, and emit SQL (banner + rename
 * statements + predrop statements + main statements + deferred statements,
 * `"\n\n"`-joined). `sql` is `""` and `hasChanges` is `false` when nothing
 * changed.
 */
export const generateMigration = (
	options: GenerateMigrationOptions,
): GenerateMigrationResult => {
	const registry = options.registry ?? createDefaultRegistry();
	const normalized = options.declarations.flatMap(resolveDeclarations);
	const snapshot = buildSnapshot(normalized, registry);

	const validatorDiagnostics = runValidators(
		options.validators ?? [],
		snapshot,
		normalized,
	);
	const warnings = [
		...validatorDiagnostics.filter((d) => d.severity === "warning"),
		...rlsUnreachableSchemaWarnings(normalized),
	];
	const validatorErrors = validatorDiagnostics
		.filter((d) => d.severity === "error")
		.map((d) => hejbroError(d.code, d.message, d.declaredAt));

	const plan = planRenames({
		previous: options.previousSnapshot,
		next: snapshot,
		renames: options.renames ?? [],
		confirmedDrops: options.confirmedDrops ?? [],
		declaredAtByIdentity: buildDeclaredAtByIdentity(options.declarations),
	});

	if (plan.errors.length > 0 || validatorErrors.length > 0) {
		return {
			snapshot,
			changes: [],
			sql: "",
			hasChanges: false,
			errors: [...plan.errors, ...validatorErrors],
			ambiguities: plan.ambiguities,
			warnings,
		};
	}

	const changes = diffSnapshots(plan.rewrittenPrevious, snapshot, registry);
	const hasChanges = changes.length > 0 || plan.renameStatements.length > 0;
	const allWarnings = [...warnings, ...notNullWithoutDefaultWarnings(changes)];

	if (!hasChanges) {
		return {
			snapshot,
			changes,
			sql: "",
			hasChanges: false,
			errors: [],
			ambiguities: [],
			warnings: allWarnings,
		};
	}

	// D74: every kind's emit sees the whole diff's changes (siblingChanges),
	// read-only and optional -- most kinds ignore it; sequenceKind/tableKind
	// use it to coordinate a serial column's single-statement add (#23).
	const emittedStatements: ReadonlyArray<{
		readonly change: KindChange;
		readonly statement: SqlStatement;
	}> = changes.flatMap((change) =>
		registry
			.get(change.kind)
			.emit(change, changes)
			.map((statement) => ({ change, statement })),
	);

	// `predrop` runs before every `main` statement, ordered by descending
	// kind-dependency rank — the same reasoning `diffSnapshots` already
	// applies to genuine `drop` changes (#122): a dependent kind's drop must
	// clear before the kind it depends on is altered. Views cannot select
	// from views in this DSL (select() takes a Table), so predrop needs no
	// intra-kind dependency sort — only the descending kind order; the
	// identity tiebreak below is for determinism, not dependency.
	const rankOf = rankKinds(registry);
	const predropStatements = emittedStatements
		.filter((entry) => entry.statement.stage === "predrop")
		.slice()
		.sort((a, b) => {
			const rankDelta = rankOf(b.change.kind) - rankOf(a.change.kind);
			if (rankDelta !== 0) {
				return rankDelta;
			}
			return compareKeys(a.change.identity, b.change.identity);
		});
	const mainStatements = emittedStatements.filter(
		(entry) => entry.statement.stage === "main",
	);
	const deferredStatements = emittedStatements.filter(
		(entry) => entry.statement.stage === "deferred",
	);

	const sql = [
		renderBanner([...plan.renameChanges, ...changes], options.bannerHashes),
		...plan.renameStatements,
		...predropStatements.map((entry) => entry.statement.sql),
		...mainStatements.map((entry) => entry.statement.sql),
		...deferredStatements.map((entry) => entry.statement.sql),
	].join("\n\n");

	return {
		snapshot,
		changes,
		sql,
		hasChanges: true,
		errors: [],
		ambiguities: [],
		warnings: allWarnings,
	};
};
