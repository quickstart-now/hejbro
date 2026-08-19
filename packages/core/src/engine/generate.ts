import type { TriggerDeclaration } from "../dsl/define-trigger";
import type { GrantSetDeclaration } from "../dsl/grant";
import type { Table, TableDeclaration } from "../dsl/table";
import { getTableMeta, isTable } from "../dsl/table";
import type { HejbroError } from "../error";
import type { HejbroDeclaration, KindChange } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { createDefaultRegistry } from "../kind/registry";
import { tableIdentity } from "../kinds/table-snapshot";
import type { Snapshot } from "../snapshot/snapshot";
import { buildSnapshot } from "../snapshot/snapshot";
import type { BannerHashes } from "../sql/migration-file";
import { renderBanner } from "../sql/migration-file";
import { diffSnapshots } from "./diff-engine";
import type {
	ConfirmDropSpec,
	RenameAmbiguity,
	RenameSpec,
} from "./rename-plan";
import { planRenames } from "./rename-plan";

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
 * Resolves one `HejbroInput` into the declaration(s) it contributes to the
 * snapshot. A `defineTrigger` declaration expands into its own function
 * declaration plus itself — `[functionDeclaration, triggerDeclaration]` —
 * so the function it creates lands in the snapshot without a separate
 * `defineFunction` call. A `grant(...).to(...)` `grant-set` expands into
 * its per-role `GrantDeclaration`s (D28 fan-out).
 */
const resolveDeclarations = (
	input: HejbroInput,
): ReadonlyArray<HejbroDeclaration> => {
	if (isTable(input)) {
		const meta = getTableMeta(input);
		if (meta.rls === null) {
			return [meta];
		}
		return [meta, meta.rls, ...meta.rls.policies];
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
};

type GenerateMigrationResult = {
	readonly snapshot: Snapshot;
	readonly changes: ReadonlyArray<KindChange>;
	readonly sql: string;
	readonly hasChanges: boolean;
	/** rename/confirm-drop diagnostics (decision D32); non-empty ⇒ `sql === ""`, `hasChanges === false`, nothing writable. */
	readonly errors: ReadonlyArray<HejbroError>;
	/** the `ambiguous-*` subset of `errors`, structured (1:1, same order) — see {@link RenameAmbiguity}. */
	readonly ambiguities: ReadonlyArray<RenameAmbiguity>;
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
 * statements + main statements + deferred statements, `"\n\n"`-joined).
 * `sql` is `""` and `hasChanges` is `false` when nothing changed.
 */
export const generateMigration = (
	options: GenerateMigrationOptions,
): GenerateMigrationResult => {
	const registry = options.registry ?? createDefaultRegistry();
	const normalized = options.declarations.flatMap(resolveDeclarations);
	const snapshot = buildSnapshot(normalized, registry);

	const plan = planRenames({
		previous: options.previousSnapshot,
		next: snapshot,
		renames: options.renames ?? [],
		confirmedDrops: options.confirmedDrops ?? [],
		declaredAtByIdentity: buildDeclaredAtByIdentity(options.declarations),
	});

	if (plan.errors.length > 0) {
		return {
			snapshot,
			changes: [],
			sql: "",
			hasChanges: false,
			errors: plan.errors,
			ambiguities: plan.ambiguities,
		};
	}

	const changes = diffSnapshots(plan.rewrittenPrevious, snapshot, registry);
	const hasChanges = changes.length > 0 || plan.renameStatements.length > 0;

	if (!hasChanges) {
		return {
			snapshot,
			changes,
			sql: "",
			hasChanges: false,
			errors: [],
			ambiguities: [],
		};
	}

	const statements = changes.flatMap((change) =>
		registry.get(change.kind).emit(change),
	);
	const mainStatements = statements.filter(
		(sqlStatement) => sqlStatement.stage === "main",
	);
	const deferredStatements = statements.filter(
		(sqlStatement) => sqlStatement.stage === "deferred",
	);

	const sql = [
		renderBanner([...plan.renameChanges, ...changes], options.bannerHashes),
		...plan.renameStatements,
		...mainStatements.map((sqlStatement) => sqlStatement.sql),
		...deferredStatements.map((sqlStatement) => sqlStatement.sql),
	].join("\n\n");

	return {
		snapshot,
		changes,
		sql,
		hasChanges: true,
		errors: [],
		ambiguities: [],
	};
};
