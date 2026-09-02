import type { FunctionDeclaration } from "../dsl/define-function";
import type { TriggerDeclaration } from "../dsl/define-trigger";
import type { GrantSetDeclaration } from "../dsl/grant";
import type { DeclaredTable, Table, TableDeclaration } from "../dsl/table";
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
	RenamePlan,
	RenameSpec,
} from "./rename-plan";
import { planRenames } from "./rename-plan";
import type { SplitDecision } from "./split";
import { applySplitChangesOnly, planSplit } from "./split";
import type { Diagnostic, Validator } from "./validate";
import { runValidators } from "./validate";

/**
 * Anything `generateMigration`/`generateMigrations` accepts as a
 * declaration: a plain declaration, or a `table()`/`existingTable()`-built
 * `Table` object (unwrapped via `getTableMeta` at the entry point) —
 * narrowed to {@link DeclaredTable} so a `"usage"`-authority value (no
 * migration authority) is rejected here at the type level, not just at the
 * runtime chokepoint in {@link resolveTableDeclarations}. Only this PUBLIC
 * type narrows; every internal helper below takes {@link AnyInput} (bare
 * `Table`, either authority) — narrowing this type's own internal uses
 * would break `isTable`'s false-branch narrowing back to
 * `HejbroDeclaration` (measured: every internal guard failed to compile
 * against the narrowed type, cascading into build errors that broke
 * unrelated tests reading this package's own compiled output).
 */
export type HejbroInput = HejbroDeclaration | DeclaredTable;

/** @see HejbroInput */
type AnyInput = HejbroDeclaration | Table;

const isTriggerDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TriggerDeclaration =>
	declaration.declarationKind === "trigger";

const isGrantSetDeclaration = (
	declaration: HejbroDeclaration,
): declaration is GrantSetDeclaration =>
	declaration.declarationKind === "grant-set";

const isFunctionDeclaration = (
	declaration: HejbroDeclaration,
): declaration is FunctionDeclaration =>
	declaration.declarationKind === "function";

/**
 * The function sibling of {@link resolveTableDeclarations}'s single
 * chokepoint (#587/G3): a synthesized `FunctionDeclaration` handed to
 * `generateMigration` used to be silently ACCEPTED, producing an
 * empty-body function migration — no refusal existed at all before this.
 * Keyed on `meta.authority === "usage"` only, mirroring the table guard's
 * own rule exactly: absence (every real `defineFunction()`/
 * `defineTrigger()` call, which never sets this field) must never trip
 * this, only a hand-built or synthesized `"usage"`-tagged value does.
 */
const resolveFunctionDeclaration = (
	meta: FunctionDeclaration,
): ReadonlyArray<HejbroDeclaration> => {
	if (meta.authority === "usage") {
		return throwHejbroError(
			"synced-function-declared",
			`function "${meta.schemaName}"."${meta.functionName}" carries no migration authority — for example, a module obtained from a database this repository does not own. Next: declare it with defineFunction() in the repository that owns its schema, or remove it from the declarations list if this repository doesn't own that schema.`,
			meta.declaredAt,
		);
	}
	return [meta];
};

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

/** {@link resolveDeclarations}'s table case — the table itself, its synthesized sequences, and (if declared) its RLS block and policies. Takes the DECLARATION, not the `Table`, so both supported input forms route through the same expansion (#408: a raw `TableDeclaration` used to skip it, silently dropping rls/policies/sequences and the existing-table guard). */
/** A raw table declaration (never a built `Table` — the `!isTable` leg keeps this predicate sound on its own, independent of `resolveDeclarations`'s branch order). */
const isTableDeclaration = (input: AnyInput): input is TableDeclaration =>
	!isTable(input) && input.declarationKind === "table";

const resolveTableDeclarations = (
	meta: TableDeclaration,
): ReadonlyArray<HejbroDeclaration> => {
	// add-unmanaged-objects: `meta.existing` no longer refuses here — an
	// `existingTable()` declaration is accepted and flows through to the
	// snapshot (`existingField`, kinds/table-kind.ts), producing no
	// statement (the guard moves to `tableKind.diff`). "existing-table-
	// declared" stays a registered code (`error.ts`'s codes are a plain
	// string, not a static union) with no live raise site.
	// The single chokepoint for the absent-authority refusal (D87
	// polyrepo-sync): keyed on `meta.authority === "usage"` only, never on
	// `!== "declared"` — a hand-assembled `TableDeclaration` that bypasses
	// every constructor carries no `authority` at all, and is
	// authored-here by definition, not a `"usage"`-tagged escapee.
	// Type-level exclusion (`HejbroInput`) already stops a `"usage"` value
	// from a type-checked caller, so this guard exists for the caller the
	// type layer never saw — a JS project, or a config file `jiti` loads
	// without a compile step (our own CLI loader does exactly that).
	if (meta.authority === "usage") {
		return throwHejbroError(
			"synced-table-declared",
			`table "${meta.schema.schemaName}"."${meta.tableName}" carries no migration authority — for example, a module obtained from a database this repository does not own. Next: declare it with table() in the repository that owns its schema, or remove it from the declarations list if this repository doesn't own that schema.`,
			meta.declaredAt,
		);
	}
	const sequences = synthesizeSequenceDeclarations(meta);
	if (meta.rls === null) {
		return [meta, ...sequences];
	}
	return [meta, ...sequences, meta.rls, ...meta.rls.policies];
};

/**
 * {@link resolveDeclarations}'s non-table branch, split out to keep each
 * function's own complexity under the CRAP gate (#587/G3 — adding the
 * function-authority guard as a fifth branch on the un-split function
 * pushed it from complexity 5 to 6, over the ratchet at full coverage).
 * A `defineTrigger` declaration expands into its own function declaration
 * plus itself — `[functionDeclaration, triggerDeclaration]` — so the
 * function it creates lands in the snapshot without a separate
 * `defineFunction` call. A `grant(...).to(...)` `grant-set` expands into
 * its per-role `GrantDeclaration`s (D28 fan-out). A plain function
 * declaration routes through {@link resolveFunctionDeclaration}'s own
 * authority guard.
 */
const resolveNonTableDeclaration = (
	input: HejbroDeclaration,
): ReadonlyArray<HejbroDeclaration> => {
	if (isTriggerDeclaration(input)) {
		return [input.functionDeclaration, input];
	}
	if (isGrantSetDeclaration(input)) {
		return input.grants;
	}
	if (isFunctionDeclaration(input)) {
		return resolveFunctionDeclaration(input);
	}
	return [input];
};

/**
 * Resolves one `HejbroInput` into the declaration(s) it contributes to the
 * snapshot. A `table()` with any `serial`-family columns expands into one
 * `SequenceDeclaration` per such column (#23/D66) — see
 * {@link resolveTableDeclarations}. Everything else routes through
 * {@link resolveNonTableDeclaration}.
 */
const resolveDeclarations = (
	input: AnyInput,
): ReadonlyArray<HejbroDeclaration> => {
	if (isTable(input)) {
		return resolveTableDeclarations(getTableMeta(input));
	}
	if (isTableDeclaration(input)) {
		return resolveTableDeclarations(input);
	}
	return resolveNonTableDeclaration(input);
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
	/** the banner's `-- hejbro: <version>` line (#229) — the CLI reads its own `package.json` for this string; core only receives it and renders it verbatim. */
	readonly hejbroVersion?: string;
	/** marks the emitted migration a brownfield baseline (#385): the objects it describes already exist, so it is registered as applied rather than run. Core only renders the marker; deciding when it is legal is the CLI's job. */
	readonly baseline?: boolean;
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
 * [G4 rework, #610] `generateMigrations`'s own options — identical to
 * `generateMigration`'s except `bannerHashes`, which this entry point
 * takes one *per migration* (index-aligned with the result's own
 * `migrations`), because a split run has more than one banner to seat.
 */
export type GenerateMigrationsOptions = Omit<
	GenerateMigrationOptions,
	"bannerHashes"
> & {
	readonly bannerHashes?: ReadonlyArray<BannerHashes>;
};

/** One file `generateMigrations` writes: its own SQL (banner included), the changes it carries (slug derivation is the caller's job), and the snapshot state this file's own chain hash names as its `snapshot:` line. */
export type GeneratedMigration = {
	readonly sql: string;
	readonly changes: ReadonlyArray<KindChange>;
	readonly snapshot: Snapshot;
};

export type GenerateMigrationsResult = {
	/** `[]` when nothing changed, one entry for an ordinary run, two for a run `generateMigration` itself would have refused (spec: "more than one only where Postgres's own transaction semantics require a boundary"). */
	readonly migrations: ReadonlyArray<GeneratedMigration>;
	readonly hasChanges: boolean;
	readonly errors: ReadonlyArray<HejbroError>;
	readonly ambiguities: ReadonlyArray<RenameAmbiguity>;
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
	declarations: ReadonlyArray<AnyInput>,
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

type ResolvedGenerateMigrationOptions = {
	readonly registry: KindRegistry;
	readonly validators: ReadonlyArray<Validator>;
	readonly renames: ReadonlyArray<RenameSpec>;
	readonly confirmedDrops: ReadonlyArray<ConfirmDropSpec>;
};

/** {@link generateMigration}'s/{@link generateMigrations}'s own optional-field defaults, resolved once up front. */
const resolveGenerateMigrationOptions = (
	options: GenerateMigrationsOptions,
): ResolvedGenerateMigrationOptions => ({
	registry: options.registry ?? createDefaultRegistry(),
	validators: options.validators ?? [],
	renames: options.renames ?? [],
	confirmedDrops: options.confirmedDrops ?? [],
});

type EmittedStatement = {
	readonly change: KindChange;
	readonly statement: SqlStatement;
};

/**
 * `predrop`-stage statements, ordered by descending kind-dependency rank
 * — the same reasoning `diffSnapshots` already applies to genuine `drop`
 * changes (#122): a dependent kind's drop must clear before the kind it
 * depends on is altered. Views cannot select from views in this DSL
 * (`select()` takes a `Table`), so predrop needs no intra-kind dependency
 * sort — only the descending kind order; the identity tiebreak is for
 * determinism, not dependency. Split out of {@link generateMigration}
 * (D71/#154 ratchet-5) so this comparator's own `if` doesn't fold into
 * that function's complexity.
 */
const sortPredropStatements = (
	emittedStatements: ReadonlyArray<EmittedStatement>,
	registry: KindRegistry,
): ReadonlyArray<EmittedStatement> => {
	const rankOf = rankKinds(registry);
	return emittedStatements
		.filter((entry) => entry.statement.stage === "predrop")
		.slice()
		.sort((a, b) => {
			const rankDelta = rankOf(b.change.kind) - rankOf(a.change.kind);
			if (rankDelta !== 0) {
				return rankDelta;
			}
			// Predrop order must not depend on diffSnapshots already sorting
			// within a kind; the tiebreak keeps emission deterministic on its
			// own instead of borrowing that guarantee from another module.
			return compareKeys(a.change.identity, b.change.identity);
		});
};

/**
 * Emits `changesToEmit`'s own SQL -- predrop, then main, then deferred,
 * `"\n\n"`-joined, `""` when `changesToEmit` is empty (never a lone blank
 * line: this function contributes nothing to an outer join in that case).
 * `siblingChanges`/`snapshot` are read-only context (D74/D78) -- a caller
 * emitting one *subset* of a run's changes (`generateMigrations`' split
 * path) still passes the run's *whole* `changes`/final `snapshot` here,
 * so every kind's `emit` sees exactly what it would have seen unsplit,
 * and splitting itself changes no kind's own decision.
 */
export const emitStatementsSql = (
	changesToEmit: ReadonlyArray<KindChange>,
	siblingChanges: ReadonlyArray<KindChange>,
	snapshot: Snapshot,
	registry: KindRegistry,
): string => {
	const emittedStatements: ReadonlyArray<EmittedStatement> =
		changesToEmit.flatMap((change) =>
			registry
				.get(change.kind)
				.emit(change, siblingChanges, snapshot)
				.map((statement) => ({ change, statement })),
		);
	const predropStatements = sortPredropStatements(emittedStatements, registry);
	const mainStatements = emittedStatements.filter(
		(entry) => entry.statement.stage === "main",
	);
	const deferredStatements = emittedStatements.filter(
		(entry) => entry.statement.stage === "deferred",
	);
	return [
		...predropStatements.map((entry) => entry.statement.sql),
		...mainStatements.map((entry) => entry.statement.sql),
		...deferredStatements.map((entry) => entry.statement.sql),
	].join("\n\n");
};

/** `[text]` unless `text` is `""`, in which case `[]` -- lets a caller splice {@link emitStatementsSql}'s result into an outer `"\n\n"`-joined array without contributing a spurious empty segment when there was nothing to emit. */
const nonEmptyPart = (text: string): ReadonlyArray<string> => {
	if (text === "") {
		return [];
	}
	return [text];
};

/**
 * One file's worth of banner + rename statements (only on the *last*
 * file -- renames are a data-level correction with nothing to do with
 * where the transaction boundary falls, so they attach to whichever
 * migration is the sequence's own tail) + this changeSet's own emitted
 * SQL. Shared by both entry points below so a single-file run and each
 * half of a split run build their SQL through the identical path.
 */
const bannerChangesFor = (
	isLastMigration: boolean,
	changeSet: ReadonlyArray<KindChange>,
	plan: RenamePlan,
): ReadonlyArray<KindChange> => {
	if (isLastMigration) {
		return [...plan.renameChanges, ...changeSet];
	}
	return changeSet;
};

const renameStatementsFor = (
	isLastMigration: boolean,
	plan: RenamePlan,
): ReadonlyArray<string> => {
	if (isLastMigration) {
		return plan.renameStatements;
	}
	return [];
};

const buildGeneratedMigrationSql = (
	changeSet: ReadonlyArray<KindChange>,
	isLastMigration: boolean,
	siblingChanges: ReadonlyArray<KindChange>,
	contextSnapshot: Snapshot,
	registry: KindRegistry,
	plan: RenamePlan,
	bannerHashes: BannerHashes | undefined,
	hejbroVersion: string | undefined,
	baseline: boolean | undefined,
): string => {
	const statementsSql = emitStatementsSql(
		changeSet,
		siblingChanges,
		contextSnapshot,
		registry,
	);
	return [
		renderBanner(
			bannerChangesFor(isLastMigration, changeSet, plan),
			bannerHashes,
			hejbroVersion,
			baseline,
		),
		...renameStatementsFor(isLastMigration, plan),
		...nonEmptyPart(statementsSql),
	].join("\n\n");
};

/**
 * The pipeline both entry points below share: build the next snapshot
 * from `declarations`, resolve `renames`/`confirmedDrops` (rule A), and
 * diff. Stops short of emitting any SQL -- that's where the two entry
 * points' contracts actually differ (one file vs. one-or-two), so it is
 * not shared past this point.
 */
type Pipeline =
	| {
			readonly blocked: true;
			readonly snapshot: Snapshot;
			readonly errors: ReadonlyArray<HejbroError>;
			readonly ambiguities: ReadonlyArray<RenameAmbiguity>;
			readonly warnings: ReadonlyArray<Diagnostic>;
	  }
	| {
			readonly blocked: false;
			readonly snapshot: Snapshot;
			readonly changes: ReadonlyArray<KindChange>;
			readonly hasChanges: boolean;
			readonly warnings: ReadonlyArray<Diagnostic>;
			readonly plan: RenamePlan;
			readonly registry: KindRegistry;
	  };

const runPipeline = (options: GenerateMigrationsOptions): Pipeline => {
	const resolved = resolveGenerateMigrationOptions(options);
	const normalized = options.declarations.flatMap(resolveDeclarations);
	const snapshot = buildSnapshot(
		normalized,
		resolved.registry,
		options.previousSnapshot,
		resolved.renames,
	);

	const validatorDiagnostics = runValidators(
		resolved.validators,
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
		renames: resolved.renames,
		confirmedDrops: resolved.confirmedDrops,
		declaredAtByIdentity: buildDeclaredAtByIdentity(options.declarations),
	});

	if (plan.errors.length > 0 || validatorErrors.length > 0) {
		return {
			blocked: true,
			snapshot,
			errors: [...plan.errors, ...validatorErrors],
			ambiguities: plan.ambiguities,
			warnings,
		};
	}

	const changes = diffSnapshots(
		plan.rewrittenPrevious,
		snapshot,
		resolved.registry,
	);
	const hasChanges = changes.length > 0 || plan.renameStatements.length > 0;
	const allWarnings = [...warnings, ...notNullWithoutDefaultWarnings(changes)];

	return {
		blocked: false,
		snapshot,
		changes,
		hasChanges,
		warnings: allWarnings,
		plan,
		registry: resolved.registry,
	};
};

/**
 * Runs the full pipeline and writes one migration per transaction
 * boundary the run needs (spec: "one migration, and more than one only
 * where Postgres's own transaction semantics require a boundary between
 * statements the run produced"). `migrations` is `[]` when nothing
 * changed, one entry for an ordinary run, two when the run adds a value
 * to an existing enum type that an expression it also emits resolves in
 * the same transaction (`engine/split.ts`'s own condition).
 *
 * D74/D78: every kind's `emit` sees the whole diff's `changes`
 * (siblingChanges) and the whole run's final `snapshot`, read-only and
 * optional, for both halves of a split run alike -- so splitting itself
 * changes no kind's own emit decision.
 */
const changeSetsFor = (
	splitDecision: SplitDecision,
	changes: ReadonlyArray<KindChange>,
): ReadonlyArray<ReadonlyArray<KindChange>> => {
	if (splitDecision.split) {
		return [splitDecision.enumChanges, splitDecision.restChanges];
	}
	return [changes];
};

const migrationSnapshotsFor = (
	splitDecision: SplitDecision,
	rewrittenPrevious: Snapshot,
	finalSnapshot: Snapshot,
): ReadonlyArray<Snapshot> => {
	if (splitDecision.split) {
		return [
			applySplitChangesOnly(rewrittenPrevious, splitDecision.enumChanges),
			finalSnapshot,
		];
	}
	return [finalSnapshot];
};

export const generateMigrations = (
	options: GenerateMigrationsOptions,
): GenerateMigrationsResult => {
	const pipeline = runPipeline(options);
	if (pipeline.blocked) {
		return {
			migrations: [],
			hasChanges: false,
			errors: pipeline.errors,
			ambiguities: pipeline.ambiguities,
			warnings: pipeline.warnings,
		};
	}
	if (!pipeline.hasChanges) {
		return {
			migrations: [],
			hasChanges: false,
			errors: [],
			ambiguities: [],
			warnings: pipeline.warnings,
		};
	}

	const splitDecision = planSplit(pipeline.changes);
	const changeSets = changeSetsFor(splitDecision, pipeline.changes);
	const migrationSnapshots = migrationSnapshotsFor(
		splitDecision,
		pipeline.plan.rewrittenPrevious,
		pipeline.snapshot,
	);

	const migrations: ReadonlyArray<GeneratedMigration> = changeSets.map(
		(changeSet, index) => ({
			sql: buildGeneratedMigrationSql(
				changeSet,
				index === changeSets.length - 1,
				pipeline.changes,
				pipeline.snapshot,
				pipeline.registry,
				pipeline.plan,
				options.bannerHashes?.[index],
				options.hejbroVersion,
				options.baseline,
			),
			changes: changeSet,
			snapshot: migrationSnapshots[index] as Snapshot,
		}),
	);

	return {
		migrations,
		hasChanges: true,
		errors: [],
		ambiguities: [],
		warnings: pipeline.warnings,
	};
};

/** `generateMigration`'s own `bannerHashes` (singular) wrapped into `generateMigrations`' array form -- omitted entirely rather than set to `undefined` (`exactOptionalPropertyTypes`), matching the same "absent means absent, never a present `undefined`" convention this codebase already follows elsewhere. */
const pipelineOptionsFor = (
	rest: Omit<GenerateMigrationOptions, "bannerHashes">,
	bannerHashes: BannerHashes | undefined,
): GenerateMigrationsOptions => {
	if (bannerHashes === undefined) {
		return rest;
	}
	return { ...rest, bannerHashes: [bannerHashes] };
};

/**
 * Runs the full pipeline for a run this function can actually represent
 * as ONE file (banner + rename statements + predrop statements + main
 * statements + deferred statements, `"\n\n"`-joined). `sql` is `""` and
 * `hasChanges` is `false` when nothing changed.
 *
 * [G4 rework, #610] A run that needs *two* files (the transaction-
 * boundary split, `generateMigrations`' own job) is refused here with a
 * coded error rather than silently returning half the run: this
 * function's contract is one migration, and a single `sql` string
 * cannot honestly carry two. Every caller of this 40-call-site, pre-
 * existing entry point keeps its exact contract for every run it could
 * already express; only the newly-representable split case is new, and
 * it fails loudly instead of arriving as a partial, misleading result.
 */
export const generateMigration = (
	options: GenerateMigrationOptions,
): GenerateMigrationResult => {
	const { bannerHashes, ...rest } = options;
	const pipeline = runPipeline(pipelineOptionsFor(rest, bannerHashes));
	if (pipeline.blocked) {
		return {
			snapshot: pipeline.snapshot,
			changes: [],
			sql: "",
			hasChanges: false,
			errors: pipeline.errors,
			ambiguities: pipeline.ambiguities,
			warnings: pipeline.warnings,
		};
	}
	if (!pipeline.hasChanges) {
		return {
			snapshot: pipeline.snapshot,
			changes: pipeline.changes,
			sql: "",
			hasChanges: false,
			errors: [],
			ambiguities: [],
			warnings: pipeline.warnings,
		};
	}

	const splitDecision = planSplit(pipeline.changes);
	if (splitDecision.split) {
		return throwHejbroError(
			"migration-requires-split",
			"this run adds a value to an existing enum type that an expression it also emits resolves inside the same transaction — Postgres refuses that combination, so it cannot be expressed as one migration file. Next: call generateMigrations() instead of generateMigration() — it returns one migration per transaction boundary this run needs.",
		);
	}

	const sql = buildGeneratedMigrationSql(
		pipeline.changes,
		true,
		pipeline.changes,
		pipeline.snapshot,
		pipeline.registry,
		pipeline.plan,
		bannerHashes,
		options.hejbroVersion,
		options.baseline,
	);

	return {
		snapshot: pipeline.snapshot,
		changes: pipeline.changes,
		sql,
		hasChanges: true,
		errors: [],
		ambiguities: [],
		warnings: pipeline.warnings,
	};
};
