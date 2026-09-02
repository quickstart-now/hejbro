import type { EnumDeclaration, SchemaDeclaration } from "@hejbro/core";
import { pgEnum } from "@hejbro/core";
import type {
	Catalog,
	EnumRow,
	FunctionRow,
	PolicyRow,
	SequenceRow,
	TriggerRow,
	ViewRow,
} from "../check/catalog";
import type { EnumLabelRow, InferenceCatalog } from "./catalog";

export type InferredEnums = {
	readonly declarations: ReadonlyArray<EnumDeclaration>;
	/** Keyed by `"schema.name"` -- 1.3/1.4's `enumDeclaration` field needs the *same* instance for every column sharing an enum type. */
	readonly byIdentity: ReadonlyMap<string, EnumDeclaration>;
};

const enumIdentity = (schema: string, name: string): string =>
	`${schema}.${name}`;

/**
 * `catalog.enums` (schema/name pairs, the shared inventory) plus
 * `enumLabels` (schema/name/label/`sortOrder`, inference's own detail
 * read) to one real `pgEnum(...)` declaration per enum type, values in
 * `enumsortorder` order -- never the order rows happened to arrive in,
 * since two independent reads (or one read's own row order) make no
 * promise about it.
 */
export const inferEnums = (
	enumRows: ReadonlyArray<EnumRow>,
	enumLabelRows: ReadonlyArray<EnumLabelRow>,
	schemaFor: (schemaName: string) => SchemaDeclaration,
): InferredEnums => {
	const declarations = enumRows.map((enumRow) => {
		const labels = enumLabelRows
			.filter(
				(label) =>
					label.schema === enumRow.schema && label.name === enumRow.name,
			)
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((label) => label.label);
		const [firstValue, ...restValues] = labels;
		if (firstValue === undefined) {
			// Postgres never allows a zero-value enum type to exist, so this
			// is unreachable from a real catalog -- guarded rather than
			// asserted past, since `pgEnum` requires a non-empty tuple type.
			throw new Error(
				`enum "${enumRow.schema}.${enumRow.name}" has no labels in the catalog`,
			);
		}
		return pgEnum(schemaFor(enumRow.schema), enumRow.name, [
			firstValue,
			...restValues,
		]);
	});
	const byIdentity = new Map(
		declarations.map((declaration) => [
			enumIdentity(declaration.schema.schemaName, declaration.enumName),
			declaration,
		]),
	);
	return { declarations, byIdentity };
};

/**
 * Distinct role names appearing in any grant the shared inventory reads
 * (table, schema-usage, default-table) -- the only role fact the
 * catalog-inference delta guesses; the grant relationships themselves
 * are never inferred.
 */
export const inferRoleNames = (catalog: Catalog): ReadonlyArray<string> => {
	const names = new Set([
		...catalog.tableGrants.map((row) => row.role),
		...catalog.schemaUsageGrants.map((row) => row.role),
		...catalog.defaultTableGrants.map((row) => row.role),
	]);
	return [...names].sort();
};

export type NotInferredSummary = {
	readonly functions: ReadonlyArray<FunctionRow>;
	readonly triggers: ReadonlyArray<TriggerRow>;
	readonly views: ReadonlyArray<ViewRow>;
	readonly policies: ReadonlyArray<PolicyRow>;
	/** A blanket rule (catalog-inference delta: "grant beyond its role name"), not a per-instance list -- every grant this reading sees is a candidate, so there is nothing to enumerate. */
	readonly grantsBeyondRoleName: true;
};

/**
 * The catalog-inference delta's own not-inferred enumeration, as data
 * that `buildLossReport` turns into report text: function, trigger,
 * view body, policy expression, and grant beyond its role name. A
 * column whose type no builder expresses is not repeated here -- it is
 * 1.3/1.4's own `ColumnLoss`, already produced where the column itself
 * is inferred.
 */
export const notInferredSummary = (catalog: Catalog): NotInferredSummary => ({
	functions: catalog.functions,
	triggers: catalog.triggers,
	views: catalog.views,
	policies: catalog.policies,
	grantsBeyondRoleName: true,
});

/**
 * Sequences no column owns (CI-G1-R1-10 (D), the lead's three-way
 * split): an identity-owned sequence (`sequenceOwnership`'s own
 * `ownership: "i"`) is already expressed by that column's identity
 * declaration, and a serial-owned one (`"a"`) by its `serial`-family
 * builder (D66: the DSL synthesizes both from that one builder) --
 * neither is a loss. A sequence in the shared inventory's own
 * `sequences` list with no matching ownership row owns no column at
 * all and has no declaration path (no `defineSequence()` in the
 * public DSL): that is the real not-inferred set.
 */
export const standaloneSequences = (
	catalog: Catalog,
	inferenceCatalog: InferenceCatalog,
): ReadonlyArray<SequenceRow> => {
	const owned = new Set(
		inferenceCatalog.sequenceOwnership.map(
			(row) => `${row.sequenceSchema}.${row.sequenceName}`,
		),
	);
	return catalog.sequences.filter(
		(sequence) => !owned.has(`${sequence.schema}.${sequence.name}`),
	);
};
