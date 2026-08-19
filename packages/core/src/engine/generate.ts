import type { HejbroDeclaration, KindChange } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { createDefaultRegistry } from "../kind/registry";
import type { Snapshot } from "../snapshot/snapshot";
import { buildSnapshot } from "../snapshot/snapshot";
import { renderBanner } from "../sql/migration-file";
import { diffSnapshots } from "./diff-engine";

type GenerateMigrationOptions = {
	readonly declarations: ReadonlyArray<HejbroDeclaration>;
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
	const snapshot = buildSnapshot(options.declarations, registry);
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
