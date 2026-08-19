import type { TriggerDeclaration } from "../dsl/define-trigger";
import type { Table } from "../dsl/table";
import { getTableMeta, isTable } from "../dsl/table";
import type { HejbroDeclaration, KindChange } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { createDefaultRegistry } from "../kind/registry";
import type { Snapshot } from "../snapshot/snapshot";
import { buildSnapshot } from "../snapshot/snapshot";
import { renderBanner } from "../sql/migration-file";
import { diffSnapshots } from "./diff-engine";

/** Anything `generateMigration` accepts as a declaration: a plain declaration, or a `table()`-built `Table` object (unwrapped via `getTableMeta` at the entry point). */
export type HejbroInput = HejbroDeclaration | Table;

const isTriggerDeclaration = (
	declaration: HejbroDeclaration,
): declaration is TriggerDeclaration =>
	declaration.declarationKind === "trigger";

/**
 * Resolves one `HejbroInput` into the declaration(s) it contributes to the
 * snapshot. A `defineTrigger` declaration expands into its own function
 * declaration plus itself — `[functionDeclaration, triggerDeclaration]` —
 * so the function it creates lands in the snapshot without a separate
 * `defineFunction` call.
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
	return [input];
};

type GenerateMigrationOptions = {
	readonly declarations: ReadonlyArray<HejbroInput>;
	readonly previousSnapshot: Snapshot;
	readonly registry?: KindRegistry;
};

type GenerateMigrationResult = {
	readonly snapshot: Snapshot;
	readonly changes: ReadonlyArray<KindChange>;
	readonly sql: string;
	readonly hasChanges: boolean;
};

/**
 * Runs the full pipeline: build the next snapshot from `declarations`,
 * diff it against `previousSnapshot`, and emit SQL (banner + main
 * statements + deferred statements, `"\n\n"`-joined). `sql` is `""` and
 * `hasChanges` is `false` when nothing changed.
 */
export const generateMigration = (
	options: GenerateMigrationOptions,
): GenerateMigrationResult => {
	const registry = options.registry ?? createDefaultRegistry();
	const normalized = options.declarations.flatMap(resolveDeclarations);
	const snapshot = buildSnapshot(normalized, registry);
	const changes = diffSnapshots(options.previousSnapshot, snapshot, registry);

	if (changes.length === 0) {
		return { snapshot, changes, sql: "", hasChanges: false };
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
		renderBanner(changes),
		...mainStatements.map((sqlStatement) => sqlStatement.sql),
		...deferredStatements.map((sqlStatement) => sqlStatement.sql),
	].join("\n\n");

	return { snapshot, changes, sql, hasChanges: true };
};
