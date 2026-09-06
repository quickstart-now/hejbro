import type { TableSnapshot } from "@hejbro/core";
import { deriveForeignKeyName } from "@hejbro/core";
import type { Catalog } from "../check/catalog";
import { compareCodeUnits } from "../compare-code-units";
import type { ColumnLoss } from "./columns";
import type { NotInferredSummary } from "./rest";
import type { InferredTableFacts } from "./table";
import {
	isExpressibleForeignKeyName,
	isExpressibleName,
	isNameDeclarable,
} from "./table";

export type UniqueIndexApproximation = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
};

/**
 * Every named UNIQUE table constraint (CI-G1-R1-06 (B), lead-confirmed
 * live: its backing index carries the identical name) -- 1.4's own
 * adapter already reads it only as that index, so this is the
 * report-side half naming the approximation. `survivingTableIdentities`
 * (D106 R5-N2) is the same "<schema>.<table>" set every sibling
 * detector reads off `mergedTables` -- this one alone used to read raw,
 * schema-filtered catalog rows with no such filter, so a UNIQUE
 * constraint on a table the reading itself omitted (an invalid name)
 * still announced an approximation for an object the very next report
 * line said was never inferred at all. The constraint's own name is
 * asked too (D106 R8-N1/#724): the surviving-table filter alone cannot
 * tell a validly named constraint from a sibling whose own name is
 * not -- the same `isExpressibleName` (D36) rule `table.ts`'s own
 * `omittedIndexes` already asks of this same object (a UNIQUE
 * constraint's backing index carries its identical name), asked here
 * so the report-side half never disagrees with the declaration-side
 * one about which UNIQUE constraints exist at all. `omittedColumnIdentities`
 * (B#1, live review) excludes a constraint whose own column was itself
 * omitted -- the delta never announces an approximation for an object
 * this reading left out entirely.
 */
export const detectUniqueIndexApproximations = (
	catalog: Catalog,
	survivingTableIdentities: ReadonlySet<string>,
	omittedColumnIdentities: ReadonlySet<string>,
): ReadonlyArray<UniqueIndexApproximation> =>
	catalog.constraints
		.filter((constraint) => constraint.type === "u")
		.filter((constraint) =>
			survivingTableIdentities.has(`${constraint.schema}.${constraint.table}`),
		)
		.filter((constraint) => isExpressibleName(constraint.name))
		.filter(
			(constraint) =>
				!constraint.columns.some((column) =>
					omittedColumnIdentities.has(
						`${constraint.schema}.${constraint.table}.${column}`,
					),
				),
		)
		.map((constraint) => ({
			schema: constraint.schema,
			table: constraint.table,
			name: constraint.name,
		}));

export type NextvalDefaultApproximation = {
	readonly schema: string;
	readonly table: string;
	readonly column: string;
	readonly sequence: string;
};

const NEXTVAL_DEFAULT = /^nextval\('([^']+)'::regclass\)$/;

/**
 * A `nextval(...)` default that survives as a plain raw default because
 * `isSerialOwned` is `false` (CI-G1-R1-10 (D)/1.5c) -- the column's
 * default calls a sequence, but no `ALTER SEQUENCE ... OWNED BY`
 * relationship makes it that column's own, so 1.3 never converts it to
 * a `serial`-family builder. Named here as the approximation it is:
 * the raw default round-trips the SQL exactly, but the sequence itself
 * stays unexpressed as a declaration (D66). The column's own name is
 * asked too (D106 R8-N1/#724, the same shape as
 * {@link detectUniqueIndexApproximations}'s own constraint-name check,
 * one level down): a column no declaration can carry reaches neither
 * the starter file nor the contract (`compose.ts`'s own
 * `tablesExcludingUndeclarableNames` excludes it there), so it must
 * never be announced as keeping a default it will never actually have
 * a chance to keep. `isNameDeclarable` is the same rule that exclusion
 * uses, asked here directly rather than through a second, narrower
 * filter on the table list this detector receives.
 */
export const detectNextvalDefaultApproximations = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<NextvalDefaultApproximation> =>
	tables.flatMap((table) =>
		table.columns.flatMap((column) => {
			if (!isNameDeclarable(column.sqlName, column.tsKey)) {
				return [];
			}
			if (column.facts.isSerialOwned || column.facts.catalogDefault === null) {
				return [];
			}
			const match = NEXTVAL_DEFAULT.exec(column.facts.catalogDefault);
			if (match === null) {
				return [];
			}
			const [, sequence] = match;
			return [
				{
					schema: column.facts.schema,
					table: table.tableName,
					column: column.sqlName,
					sequence: sequence ?? "",
				},
			];
		}),
	);

export type ForeignKeyNameApproximation = {
	readonly schema: string;
	readonly table: string;
	/** The catalog's own name -- unexpressible per D36, never written into a declaration. */
	readonly catalogName: string;
	/** What the starter file's own foreign key derives instead. */
	readonly derivedName: string;
};

/**
 * A foreign key whose catalog name isn't a valid hejbro SQL identifier
 * (D106 R3-B3) -- most often a database hejbro did not create, whose own
 * FK naming convention Postgres itself never enforces past NAMEDATALEN
 * and legality. `infer/table.ts`'s `isExpressibleForeignKeyName` is this
 * same D36 check both sides call, so the declaration-side and the
 * report-side can never drift.
 */
export const detectForeignKeyNameApproximations = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<ForeignKeyNameApproximation> =>
	tables.flatMap((table) =>
		table.foreignKeys.flatMap((fk) => {
			if (isExpressibleForeignKeyName(fk.name)) {
				return [];
			}
			return [
				{
					schema: table.schema.schemaName,
					table: table.tableName,
					catalogName: fk.name,
					derivedName: deriveForeignKeyName(table.tableName, fk.sourceColumns),
				},
			];
		}),
	);

export type PrimaryKeyNameApproximation = {
	readonly schema: string;
	readonly table: string;
	/** The catalog's own constraint name -- kept as raw SQL text, never written into a declaration (the DSL derives every primary-key name, D68). */
	readonly catalogName: string;
	/** What `generate`/`check` derive instead, and what a rename must target. */
	readonly derivedName: string;
};

/**
 * A primary key whose catalog constraint name is not the one the DSL
 * itself derives (`"<table>_pkey"`, D68) -- measured directly against
 * `migration.snapshot`'s own `primaryKeyName` (712/R7), never a second,
 * local re-implementation of the derivation rule core already applies
 * when it builds that snapshot. Only a surviving, primary-keyed table
 * can differ this way: `tables` here is `migration.snapshot`'s own
 * table nodes, so an omitted table (no node at all) or a table with no
 * primary key (`primaryKeyName` absent) never reaches this comparison.
 */
export const detectPrimaryKeyNameApproximations = (
	catalog: Catalog,
	tables: ReadonlyArray<TableSnapshot>,
): ReadonlyArray<PrimaryKeyNameApproximation> =>
	tables.flatMap((table) => {
		if (table.primaryKeyName === undefined) {
			return [];
		}
		const constraint = catalog.constraints.find(
			(row) =>
				row.type === "p" &&
				row.schema === table.schema &&
				row.table === table.name,
		);
		if (constraint === undefined || constraint.name === table.primaryKeyName) {
			return [];
		}
		return [
			{
				schema: table.schema,
				table: table.name,
				catalogName: constraint.name,
				derivedName: table.primaryKeyName,
			},
		];
	});

/**
 * A column whose SQL name a declaration cannot carry, for one of two
 * different reasons ({@link cause}) -- excluded from both commands' own
 * snapshot (CI-G1-R1-16, `compose.ts`'s `tablesExcludingUndeclarableNames`),
 * so neither `import`'s starter file nor `pull`'s contract ever carries
 * it (the type doc this replaces claimed `pull`'s own contract carried
 * every column regardless -- false: `contract/from-catalog.ts`'s own
 * `computeTable`/`buildColumnEntries` iterate the snapshot's columns,
 * never the description's, so an excluded column is simply never
 * reached there either).
 */
export type UndeclarableNameColumn = {
	readonly schema: string;
	readonly table: string;
	readonly sqlName: string;
	/**
	 * Which half of `isNameDeclarable` (`table.ts`) failed, set in
	 * `compose.ts`'s own `undeclarableColumnCause`, where both halves
	 * are already in hand rather than re-derived here (D106 R6-N1).
	 * `"noDeclarationKey"`: no key produces this SQL name
	 * back at all (`toSnakeCase` never yields it -- a quoted
	 * `"createdAt"`'s shape). `"identifierRuleRejects"`: a key does
	 * produce this name back, but D36 itself refuses it (the
	 * leading-underscore `_id` shape). Both have the same, and only,
	 * remedy: renaming in the database. `buildColumnEntries`
	 * (`core/src/dsl/table.ts`) derives every column's SQL name from its
	 * key and accepts no explicit override, so no hand-written
	 * declaration -- in this repository or a linked one -- can carry
	 * either kind of name; "declared by hand" was never a real remedy
	 * for either cause.
	 */
	readonly cause: "noDeclarationKey" | "identifierRuleRejects";
};

/**
 * A schema whose catalog name is not a valid hejbro SQL identifier
 * (D106 R4-B1) -- omitted along with every table, enum and sequence it
 * holds, since a declaration's schema identity is that name itself,
 * with no separate key to declare it under the way a column has.
 */
export type OmittedSchema = {
	readonly sqlName: string;
};

/**
 * A table whose catalog name is not a valid hejbro SQL identifier
 * (D106 R4-B1) -- omitted along with everything it holds (columns,
 * checks, indexes, foreign keys), for the same reason a schema is.
 * `stillReportedInInventory` is `true` when its own schema still holds
 * another declared table or enum -- `check`'s own inventory (#707)
 * keeps naming this table as unmanaged on every run in that case;
 * `false` when the omitted table was the only thing that schema would
 * have declared, the same "nothing declared here" gap the schema-level
 * omission line already states directly.
 */
export type OmittedTable = {
	readonly schema: string;
	readonly sqlName: string;
	readonly stillReportedInInventory: boolean;
};

/**
 * An enum type whose catalog name is not a valid hejbro SQL identifier
 * (712/R3, D36) -- `pgEnum` asserts nothing about its own name, so this
 * is the one identifier the DSL never rejects on its own; omitted here
 * along with every column typed by it, since a column's type node can
 * only ever reference a declared enum. `columns` names only the ones
 * the enum's own omission itself takes out -- a column already omitted
 * for its own name is reported by that column's own line instead
 * (D2: no object appears on two lines).
 */
export type OmittedEnum = {
	readonly schema: string;
	readonly sqlName: string;
	readonly columns: ReadonlyArray<{
		readonly schema: string;
		readonly table: string;
		readonly sqlName: string;
	}>;
};

/** An index whose catalog name is not a valid hejbro SQL identifier (D106 R4-B1) -- costs that index alone; the table and its other objects are still declared. */
export type OmittedIndex = {
	readonly schema: string;
	readonly table: string;
	readonly sqlName: string;
};

/** A check constraint whose catalog name is not a valid hejbro SQL identifier (D106 R4-B1) -- costs that check alone; the table and its other objects are still declared. */
export type OmittedCheck = {
	readonly schema: string;
	readonly table: string;
	readonly sqlName: string;
};

/**
 * A foreign key whose own name is a valid hejbro SQL identifier, but
 * whose *target*'s own schema or table name is not (D106 R6-B1) --
 * `existingTable(fk.targetSchema, fk.targetTable, …)` would otherwise
 * assert a name the reading already knows it cannot carry, aborting
 * the whole reading over a reference into an object one report line up
 * already says has no declaration. A target this run simply never read
 * (a schema `--schema` did not name) is not this case: its own name is
 * fine, so the foreign key survives instead, declared against an
 * `existingTable` handle (`declare-emit/emit.ts`'s own
 * `mustDeferForeignKey`) rather than a real cross-file import. Costs
 * that foreign key alone; the table holding it and everything else on
 * it are still declared.
 */
export type OmittedForeignKey = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	/** Whether the target was left out because its own table name was inexpressible, or because its whole schema was. */
	readonly targetKind: "table" | "schema";
	/** `"<schema>.<table>"` for a `"table"` target, `"<schema>"` alone for a `"schema"` one -- the identity `undeclarableNameLine`'s own sibling lines already use. */
	readonly target: string;
};

/**
 * A foreign key whose own name and target are both fine, but whose own
 * source column, or its target's own column, was itself omitted --
 * either for an undeclarable name (#873) or with its own enum type
 * (712/R8) -- costs that foreign key alone; the table holding it and
 * everything else on it are still declared. `end` names which side
 * failed, since that side is which column the remedy renames (712/R5):
 * `"source"` reads "it is declared on column …", `"target"` reads "it
 * references column …". `cause` is which rule excluded that column --
 * the reason and way-out clauses follow it (712/R8): a name cause points
 * at renaming the column, an enum cause (carrying that enum's own
 * identity) points at renaming the type instead. When both ends of the
 * same key failed, only one line is ever rendered, for the source end
 * (712/R9, D2 -- `omittedForeignKeyColumnLines`'s own dedup, not this
 * type's concern).
 */
export type OmittedForeignKeyColumn = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	/** `"<schema>.<table>.<sqlName>"` of the omitted column that cost this foreign key. */
	readonly columnIdentity: string;
	readonly end: "source" | "target";
	readonly cause: "name" | "enum";
	/** The enum type's own `"<schema>.<name>"` identity -- present only when `cause` is `"enum"` (712/R8). */
	readonly enumIdentity?: string;
};

export type LossReportFacts = {
	readonly command: "import" | "pull";
	readonly roleNames: ReadonlyArray<string>;
	readonly notInferred: NotInferredSummary;
	readonly standaloneSequences: ReadonlyArray<{
		readonly schema: string;
		readonly name: string;
	}>;
	readonly typeLosses: ReadonlyArray<ColumnLoss>;
	readonly uniqueIndexApproximations: ReadonlyArray<UniqueIndexApproximation>;
	readonly nextvalDefaults: ReadonlyArray<NextvalDefaultApproximation>;
	readonly foreignKeyNameApproximations: ReadonlyArray<ForeignKeyNameApproximation>;
	readonly primaryKeyNameApproximations: ReadonlyArray<PrimaryKeyNameApproximation>;
	readonly undeclarableNameColumns: ReadonlyArray<UndeclarableNameColumn>;
	readonly omittedSchemas: ReadonlyArray<OmittedSchema>;
	readonly omittedTables: ReadonlyArray<OmittedTable>;
	readonly omittedEnums: ReadonlyArray<OmittedEnum>;
	readonly omittedIndexes: ReadonlyArray<OmittedIndex>;
	readonly omittedChecks: ReadonlyArray<OmittedCheck>;
	readonly omittedForeignKeys: ReadonlyArray<OmittedForeignKey>;
	readonly omittedForeignKeysByColumn: ReadonlyArray<OmittedForeignKeyColumn>;
};

const guessedLine = (
	roleNames: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const base =
		"Guessed: TypeScript keys from SQL names, the default numeric mode, and unknown array-element nullability (read as nullable).";
	if (roleNames.length === 0) {
		return [base];
	}
	return [base, `Guessed role names: ${roleNames.join(", ")}.`];
};

/**
 * Sorts a copy by a caller-supplied string key (D106 N3) -- every
 * per-instance loss-report line below is built from an array this
 * module never controls the origin order of (a catalog reading, a
 * `Promise.all` of several), so each is sorted here, explicitly, right
 * before it is rendered, rather than trusting an upstream read to have
 * stayed in a stable order all the way through.
 */
const sortedBy = <T>(
	items: ReadonlyArray<T>,
	keyOf: (item: T) => string,
): ReadonlyArray<T> =>
	[...items].sort((a, b) => compareCodeUnits(keyOf(a), keyOf(b)));

const countedKindLine = (
	label: string,
	count: number,
): ReadonlyArray<string> => {
	if (count === 0) {
		return [];
	}
	return [`Not inferred: ${count} ${label} not inferred.`];
};

/**
 * The catalog-inference delta's own not-inferred enumeration, in this
 * order: function, trigger, view body, policy expression, grant beyond
 * its role name (a blanket rule, never a per-instance list), a column
 * whose type no builder expresses, and a standalone sequence no column
 * owns.
 */
const notInferredLines = (
	summary: NotInferredSummary,
	standaloneSequences: LossReportFacts["standaloneSequences"],
	typeLosses: ReadonlyArray<ColumnLoss>,
): ReadonlyArray<string> => [
	...countedKindLine("function(s)", summary.functions.length),
	...countedKindLine("trigger(s)", summary.triggers.length),
	...countedKindLine("view(s)", summary.views.length),
	...countedKindLine("policy expression(s)", summary.policies.length),
	"Not inferred: grants beyond their role name.",
	...sortedBy(
		typeLosses,
		(loss) => `${loss.schema}.${loss.table}.${loss.column}`,
	).map(
		(loss) =>
			`Not inferred: column "${loss.schema}.${loss.table}.${loss.column}" (type "${loss.sqlType}") -- no column builder expresses it.`,
	),
	...sortedBy(
		standaloneSequences,
		(sequence) => `${sequence.schema}.${sequence.name}`,
	).map(
		(sequence) =>
			`Not inferred: sequence "${sequence.schema}.${sequence.name}" -- no column owns it, and the DSL has no defineSequence() (D66).`,
	),
];

/** Unconditional (CI-G2-R1-06 Q4 follow-up, lead-approved): every reading carries default/check/generated/index-predicate expressions as raw SQL text, never the typed builders (`inArray`, `gte`, ...) a hand-written declaration would use -- there is no per-instance list to derive this from, the same shape as the "grants beyond their role name" line below it. */
const EXPRESSION_APPROXIMATION_LINE =
	"Approximated: every default, check, generated, and index-predicate expression is carried as raw SQL text, not the typed builders a hand-written declaration would use.";

const approximationLines = (
	uniqueIndexApproximations: ReadonlyArray<UniqueIndexApproximation>,
	nextvalDefaults: ReadonlyArray<NextvalDefaultApproximation>,
	foreignKeyNameApproximations: ReadonlyArray<ForeignKeyNameApproximation>,
	primaryKeyNameApproximations: ReadonlyArray<PrimaryKeyNameApproximation>,
): ReadonlyArray<string> => [
	...sortedBy(
		uniqueIndexApproximations,
		(approximation) =>
			`${approximation.schema}.${approximation.table}.${approximation.name}`,
	).map(
		(approximation) =>
			`Approximated: the UNIQUE constraint "${approximation.schema}.${approximation.table}.${approximation.name}" is inferred as a unique index of the same name -- re-creating it emits \`create unique index\`, not \`add constraint ... unique\`.`,
	),
	...sortedBy(
		nextvalDefaults,
		(nextval) => `${nextval.schema}.${nextval.table}.${nextval.column}`,
	).map(
		(nextval) =>
			`Approximated: column "${nextval.schema}.${nextval.table}.${nextval.column}" keeps its \`nextval('${nextval.sequence}')\` default as a raw expression, naming the sequence it does not own.`,
	),
	...sortedBy(
		foreignKeyNameApproximations,
		(approximation) =>
			`${approximation.schema}.${approximation.table}.${approximation.catalogName}`,
	).map(
		(approximation) =>
			`Approximated: the foreign key "${approximation.schema}.${approximation.table}.${approximation.catalogName}" is declared under the derived name "${approximation.derivedName}" instead -- its own catalog name is not a valid hejbro SQL identifier, so \`generate\`/\`check\` will name this constraint differently from the database.`,
	),
	...sortedBy(
		primaryKeyNameApproximations,
		(approximation) =>
			`${approximation.schema}.${approximation.table}.${approximation.catalogName}`,
	).map(
		(approximation) =>
			`Approximated: the primary key "${approximation.schema}.${approximation.table}.${approximation.catalogName}" is declared under the derived name "${approximation.derivedName}" instead -- the DSL derives every primary-key name, so \`generate\`/\`check\` will name this constraint differently from the database. Rename the constraint to "${approximation.derivedName}" in the database; until you do, \`check\` reports the declared "${approximation.derivedName}" as missing on every run and lists "${approximation.catalogName}" in its unmanaged-index inventory.`,
	),
	EXPRESSION_APPROXIMATION_LINE,
];

/** D106 R6-N1: the reason clause `cause` actually earned, never one sentence stretched to cover both. */
const undeclarableColumnReason = (
	cause: UndeclarableNameColumn["cause"],
): string => {
	if (cause === "identifierRuleRejects") {
		return "a key does produce this name back, but it is not a valid hejbro SQL identifier";
	}
	return "no declaration key produces this SQL name back";
};

/** import's own consequence: the table is left only partly declared, and `check` keeps reporting the column until it is renamed in the database -- the only remedy that exists for either cause (D106 R6-N1: "declared by hand" never was one). Review round 1 N3, lead ruling 707/R3: renaming alone only makes the name one a declaration can carry -- `check` goes on naming the column as unmanaged until a declaration actually covers it, so the line names the whole exit condition. */
const undeclarableNameLineForImport = (
	column: UndeclarableNameColumn,
): string =>
	`Omitted: column "${column.schema}.${column.table}.${column.sqlName}" -- ${undeclarableColumnReason(column.cause)}. The table "${column.schema}.${column.table}" is only partly declared, and \`check\` reports this column until it is renamed in the database and declared.`;

/** pull's own consequence (CI-G1-R1-16): `contract/from-catalog.ts`'s own `computeTable`/`buildColumnEntries` iterate the snapshot's columns, never the description's, so a column excluded from the snapshot never reaches the contract -- renaming in the database, then linking the schema repository, is the only way out (D106 R6-N1: not "declared by hand", for either cause). */
const undeclarableNameLineForPull = (column: UndeclarableNameColumn): string =>
	`Omitted: column "${column.schema}.${column.table}.${column.sqlName}" -- ${undeclarableColumnReason(column.cause)}, so it cannot be carried in the contract. Rename the column in the database, then link the schema repository.`;

/** Excluded from both commands' snapshots (CI-G1-R1-16) -- neither can carry a column under a name the database does not have. Only the consequence sentence differs. */
const undeclarableNameLines = (
	columns: ReadonlyArray<UndeclarableNameColumn>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		columns,
		(column) => `${column.schema}.${column.table}.${column.sqlName}`,
	);
	if (command === "pull") {
		return ordered.map(undeclarableNameLineForPull);
	}
	return ordered.map(undeclarableNameLineForImport);
};

/**
 * import's own consequence: no declaration file can name a schema
 * whose own identifier hejbro cannot express, so every table, enum and
 * sequence it holds goes with it -- and unlike an omitted table under
 * an otherwise-declared schema (`check`'s own inventory still lists
 * that one, see {@link omittedTableLineForImport}), a whole omitted
 * schema has no declared sibling left to anchor an inventory scan on
 * (#707): nothing in it is declared, so `check` never lists it either.
 */
const omittedSchemaLineForImport = (schema: OmittedSchema): string =>
	`Omitted: schema "${schema.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. Its tables, enums and sequences are not inferred either, and \`check\` will not list them, since nothing in that schema is declared. Next: rename the schema in the database, then re-run \`hejbro import\`.`;

/** pull's own consequence: a table under an unexpressible schema can reach neither the snapshot nor the contract. */
const omittedSchemaLineForPull = (schema: OmittedSchema): string =>
	`Omitted: schema "${schema.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so nothing it holds (tables, enums, sequences) can be carried in the contract. Rename the schema in the database, then link the schema repository.`;

const omittedSchemaLines = (
	schemas: ReadonlyArray<OmittedSchema>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(schemas, (schema) => schema.sqlName);
	if (command === "pull") {
		return ordered.map(omittedSchemaLineForPull);
	}
	return ordered.map(omittedSchemaLineForImport);
};

/**
 * import's own consequence: the table's own identifier is what a
 * declaration would need to name it by, so everything it holds
 * (columns, checks, indexes, foreign keys) goes with it. `check`'s own
 * inventory (existence-only, informational, never a failing check)
 * keeps listing it as unmanaged on every run, the same way it now does
 * an omitted index or check (harden-check-inventory, #707 -- see
 * {@link omittedIndexLine}), as long as its own schema is still
 * declared (by its other, expressible tables). Review round 2 B1:
 * renaming alone only makes the name one a declaration can carry --
 * `check` goes on naming the table as unmanaged until a declaration
 * actually covers it (measured live: renaming the table left it
 * listed), so the line names the whole exit condition.
 */
const omittedTableConsequenceForImport = (
	stillReportedInInventory: boolean,
): string => {
	if (stillReportedInInventory) {
		return "`check` keeps listing the table itself in its unmanaged-table inventory (informational, never a failing check) until it is renamed in the database and declared.";
	}
	return "the omitted table was the only thing that schema would have declared, so nothing keeps naming it after this run's own report -- rename it in the database, or declare its schema's other objects so `check`'s inventory has something to anchor on.";
};

const omittedTableLineForImport = (table: OmittedTable): string =>
	`Omitted: table "${table.schema}.${table.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. Everything it holds (columns, checks, indexes and foreign keys) is left undeclared, and ${omittedTableConsequenceForImport(table.stillReportedInInventory)}`;

/** pull's own consequence, mirroring `undeclarableNameLineForPull`'s own reasoning one level up: the whole table, not one column, cannot reach the contract. */
const omittedTableLineForPull = (table: OmittedTable): string =>
	`Omitted: table "${table.schema}.${table.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so it cannot be carried in the contract, with everything it holds. Rename the table in the database, then link the schema repository.`;

const omittedTableLines = (
	tables: ReadonlyArray<OmittedTable>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		tables,
		(table) => `${table.schema}.${table.sqlName}`,
	);
	if (command === "pull") {
		return ordered.map(omittedTableLineForPull);
	}
	return ordered.map(omittedTableLineForImport);
};

/** The enum's own columns, sorted by `schema.table.sqlName` (1.4's shared comparator) and quoted -- the identity list a line's own sentence names inline. */
const omittedEnumColumnList = (columns: OmittedEnum["columns"]): string =>
	sortedBy(
		columns,
		(column) => `${column.schema}.${column.table}.${column.sqlName}`,
	)
		.map((column) => `"${column.schema}.${column.table}.${column.sqlName}"`)
		.join(", ");

/** import's own consequence, with columns: the type and every column it takes with it are both left out, and `check` never names the type itself -- its inventory has no enum axis (712/R2's own measured rule, extended to the type's own omission). */
const omittedEnumLineForImportWithColumns = (
	enumOmission: OmittedEnum,
): string =>
	`Omitted: enum type "${enumOmission.schema}.${enumOmission.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it, and every column typed by it is left out with it: ${omittedEnumColumnList(enumOmission.columns)}. \`check\` keeps naming each of them as unmanaged until it is declared, and never names the type itself -- its inventory has no enum axis. Next: rename the type in the database, re-run \`hejbro import\`, and declare both.`;

/** import's own consequence, no column typed by it: nothing else is left out. */
const omittedEnumLineForImportWithoutColumns = (
	enumOmission: OmittedEnum,
): string =>
	`Omitted: enum type "${enumOmission.schema}.${enumOmission.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. No column is typed by it, so nothing else is left out, and \`check\` never names the type -- its inventory has no enum axis. Next: rename the type in the database and re-run \`hejbro import\`.`;

const omittedEnumLineForImport = (enumOmission: OmittedEnum): string => {
	if (enumOmission.columns.length === 0) {
		return omittedEnumLineForImportWithoutColumns(enumOmission);
	}
	return omittedEnumLineForImportWithColumns(enumOmission);
};

/** pull's own consequence, with columns: mirrors `undeclarableNameLineForPull`'s own "cannot be carried in the contract" wording, extended to the type and every column it takes with it. No `check` sentence, as every pull-side sibling line. */
const omittedEnumLineForPullWithColumns = (enumOmission: OmittedEnum): string =>
	`Omitted: enum type "${enumOmission.schema}.${enumOmission.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so neither it nor the columns typed by it can be carried in the contract: ${omittedEnumColumnList(enumOmission.columns)}. Rename the type in the database, then link the schema repository.`;

const omittedEnumLineForPullWithoutColumns = (
	enumOmission: OmittedEnum,
): string =>
	`Omitted: enum type "${enumOmission.schema}.${enumOmission.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so it cannot be carried in the contract. Rename the type in the database, then link the schema repository.`;

const omittedEnumLineForPull = (enumOmission: OmittedEnum): string => {
	if (enumOmission.columns.length === 0) {
		return omittedEnumLineForPullWithoutColumns(enumOmission);
	}
	return omittedEnumLineForPullWithColumns(enumOmission);
};

/** D5 (712/R3): follows the omitted-table lines, precedes the omitted-index lines -- schema-level objects first, then table-level ones; sorted by `schema.sqlName`, 1.4's shared comparator. */
const omittedEnumLines = (
	enums: ReadonlyArray<OmittedEnum>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		enums,
		(enumOmission) => `${enumOmission.schema}.${enumOmission.sqlName}`,
	);
	if (command === "pull") {
		return ordered.map(omittedEnumLineForPull);
	}
	return ordered.map(omittedEnumLineForImport);
};

/**
 * An index's own name is compared by `check`, so declaring it under any
 * other name than the catalog's would leave `check` reporting the
 * declared (wrong) name as missing and the catalog's own name as
 * unmanaged, forever -- the same drift the round-3 foreign-key fix
 * exists to prevent, not reproduce. Omission costs only this index; a
 * vendored contract never carries indexes at all (`contract/emit.ts`),
 * so the two commands share one line. `check`'s own inventory
 * (harden-check-inventory, #707) keeps naming this index as unmanaged
 * on every run, the same way it does an omitted table (see
 * {@link omittedTableConsequenceForImport}) -- this line states that,
 * never that hejbro will not mention it again. Review round 1 N3:
 * renaming alone only makes the name declarable -- the inventory keeps
 * naming the index until a declaration actually covers it, so the line
 * names the whole exit condition, not just its first half.
 */
const omittedIndexLine = (index: OmittedIndex): string =>
	`Omitted: index "${index.schema}.${index.table}.${index.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it under the same name \`check\` would compare it by. \`check\` keeps listing it as unmanaged until it is renamed in the database and declared; a hand-written declaration under a different name only adds a second one.`;

/** pull's own consequence (D106 round 1 B1 of harden-check-inventory): a pull consumer holds no declarations of the producer's schema, so no `check` listing follows -- the index cannot be carried in the contract, and linking the schema repository is the way out, as for every other pull line. */
const omittedIndexLineForPull = (index: OmittedIndex): string =>
	`Omitted: index "${index.schema}.${index.table}.${index.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so it cannot be carried in the contract. Rename the index in the database, then link the schema repository.`;

const omittedIndexLines = (
	indexes: ReadonlyArray<OmittedIndex>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		indexes,
		(index) => `${index.schema}.${index.table}.${index.sqlName}`,
	);
	if (command === "pull") {
		return ordered.map(omittedIndexLineForPull);
	}
	return ordered.map(omittedIndexLine);
};

/** A check constraint's own name is compared by `check` the same way an index's is (see {@link omittedIndexLine}) -- omission costs only this check, and a vendored contract never carries checks either. */
const omittedCheckLine = (check: OmittedCheck): string =>
	`Omitted: check constraint "${check.schema}.${check.table}.${check.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it under the same name \`check\` would compare it by. \`check\` keeps listing it as unmanaged until it is renamed in the database and declared; a hand-written declaration under a different name only adds a second one.`;

const omittedCheckLineForPull = (check: OmittedCheck): string =>
	`Omitted: check constraint "${check.schema}.${check.table}.${check.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so it cannot be carried in the contract. Rename the constraint in the database, then link the schema repository.`;

const omittedCheckLines = (
	checks: ReadonlyArray<OmittedCheck>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		checks,
		(check) => `${check.schema}.${check.table}.${check.sqlName}`,
	);
	if (command === "pull") {
		return ordered.map(omittedCheckLineForPull);
	}
	return ordered.map(omittedCheckLine);
};

/** import's own remedy: renaming the target (in the database) is what makes it reachable again, and only a fresh reading picks that up. */
const omittedForeignKeyRemedyForImport = (
	targetKind: OmittedForeignKey["targetKind"],
): string => {
	if (targetKind === "schema") {
		return "rename the schema in the database, then re-run `hejbro import`.";
	}
	return "rename the table in the database, then re-run `hejbro import`.";
};

/** pull's own remedy, mirroring the schema/table omission lines' own pull wording -- no "re-run", since `pull` names the same live database on every run by construction. */
const omittedForeignKeyRemedyForPull = (
	targetKind: OmittedForeignKey["targetKind"],
): string => {
	if (targetKind === "schema") {
		return "Rename the schema in the database, then link the schema repository.";
	}
	return "Rename the table in the database, then link the schema repository.";
};

/**
 * D106 R6-B1: a foreign key whose own name is fine but whose *target*'s
 * own name is not -- costs that one foreign key, never the table
 * holding it (which is still declared, minus this one relation) nor
 * the whole reading. Named by the target's own identity and kind,
 * since "which kind of object's name is bad" changes nothing about
 * *why* -- only about what fixing it requires. A target this run
 * simply never read is never named here at all (it is kept, not
 * omitted -- see {@link OmittedForeignKey}).
 */
const omittedForeignKeyLineForImport = (fk: OmittedForeignKey): string =>
	`Omitted: foreign key "${fk.schema}.${fk.table}.${fk.name}" -- references ${fk.targetKind} "${fk.target}", whose catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. Next: ${omittedForeignKeyRemedyForImport(fk.targetKind)}`;

const omittedForeignKeyLineForPull = (fk: OmittedForeignKey): string =>
	`Omitted: foreign key "${fk.schema}.${fk.table}.${fk.name}" -- references ${fk.targetKind} "${fk.target}", whose catalog name is not a valid hejbro SQL identifier, so no declaration can carry it. ${omittedForeignKeyRemedyForPull(fk.targetKind)}`;

const omittedForeignKeyLines = (
	foreignKeys: ReadonlyArray<OmittedForeignKey>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		foreignKeys,
		(fk) => `${fk.schema}.${fk.table}.${fk.name}`,
	);
	if (command === "pull") {
		return ordered.map(omittedForeignKeyLineForPull);
	}
	return ordered.map(omittedForeignKeyLineForImport);
};

/** 712/R5: which end failed is which column the remedy renames -- `"source"` reads as this table's own column, `"target"` as the far table's. */
const foreignKeyColumnReasonClause = (
	end: OmittedForeignKeyColumn["end"],
): string => {
	if (end === "target") {
		return "it references column";
	}
	return "it is declared on column";
};

/**
 * 712/R8: the reason and way-out clauses follow the omitted column's own
 * cause -- a name cause keeps 712/R5's own wording, unchanged; an enum
 * cause names the enum type itself and points at renaming it instead of
 * the column, since the column's own name was never the problem.
 */
const omittedForeignKeyColumnReasonForImport = (
	entry: OmittedForeignKeyColumn,
): string => {
	if (entry.cause === "enum") {
		return `${foreignKeyColumnReasonClause(entry.end)} "${entry.columnIdentity}", which this reading left out with the enum type "${entry.enumIdentity}" that types it, so the key cannot be declared either. Next: rename the type in the database, then re-run \`hejbro import\`.`;
	}
	return `${foreignKeyColumnReasonClause(entry.end)} "${entry.columnIdentity}", which this reading left out because no declaration can carry its name, so the key cannot be declared either. Next: rename the column in the database, then re-run \`hejbro import\`.`;
};

/** pull's own consequence, mirroring `undeclarableNameLineForPull`'s own wording for the column itself (712/R5), and 712/R8's own enum-cause branch. */
const omittedForeignKeyColumnReasonForPull = (
	entry: OmittedForeignKeyColumn,
): string => {
	if (entry.cause === "enum") {
		return `${foreignKeyColumnReasonClause(entry.end)} "${entry.columnIdentity}", which this reading left out with the enum type "${entry.enumIdentity}" that types it, so the key cannot be carried either. Rename the type in the database, then link the schema repository.`;
	}
	return `${foreignKeyColumnReasonClause(entry.end)} "${entry.columnIdentity}", which this reading left out because no declaration can carry its name, so it cannot be carried in the contract, so the key cannot be carried either. Rename the column in the database, then link the schema repository.`;
};

const omittedForeignKeyColumnLineForImport = (
	entry: OmittedForeignKeyColumn,
): string =>
	`Omitted: foreign key "${entry.schema}.${entry.table}.${entry.name}" -- ${omittedForeignKeyColumnReasonForImport(entry)}`;

const omittedForeignKeyColumnLineForPull = (
	entry: OmittedForeignKeyColumn,
): string =>
	`Omitted: foreign key "${entry.schema}.${entry.table}.${entry.name}" -- ${omittedForeignKeyColumnReasonForPull(entry)}`;

/**
 * 712/R9, D2: a foreign key lost at both ends is announced once, never
 * twice -- the source end wins (the column this table's own declaration
 * is on, per 712/R9's own ruling), so a target-end duplicate for the
 * same key is dropped here, before rendering, the same way `sortedBy`
 * normalizes order here rather than trusting an upstream read.
 */
const preferSourceEnd = (
	existing: OmittedForeignKeyColumn,
	candidate: OmittedForeignKeyColumn,
): OmittedForeignKeyColumn => {
	if (existing.end === "source") {
		return existing;
	}
	return candidate;
};

const oneLinePerForeignKey = (
	entries: ReadonlyArray<OmittedForeignKeyColumn>,
): ReadonlyArray<OmittedForeignKeyColumn> => {
	const byIdentity = entries.reduce((map, entry) => {
		const identity = `${entry.schema}.${entry.table}.${entry.name}`;
		const existing = map.get(identity);
		if (existing === undefined) {
			map.set(identity, entry);
			return map;
		}
		map.set(identity, preferSourceEnd(existing, entry));
		return map;
	}, new Map<string, OmittedForeignKeyColumn>());
	return [...byIdentity.values()];
};

const omittedForeignKeyColumnLines = (
	entries: ReadonlyArray<OmittedForeignKeyColumn>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	const ordered = sortedBy(
		oneLinePerForeignKey(entries),
		(entry) => `${entry.schema}.${entry.table}.${entry.name}`,
	);
	if (command === "pull") {
		return ordered.map(omittedForeignKeyColumnLineForPull);
	}
	return ordered.map(omittedForeignKeyColumnLineForImport);
};

const wayOutLine = (command: LossReportFacts["command"]): string => {
	if (command === "pull") {
		return "The loss ends when you link the schema repository.";
	}
	return "The loss ends when you hand-edit the starter declarations.";
};

/**
 * D106 R6-N3: a caller that must add lines to an already-built report
 * (`commands/import.ts`'s own empty-schema lines, known only once
 * `emitDeclarationFiles` has run, after `buildLossReport` already
 * closed with the way-out line) needs them placed *before* the way-out
 * line, which SHALL stay the report's own last line -- located here by
 * identity (`wayOutLine(command)`), never by an assumed index, so
 * there is no throw path in a command and no assumption that some
 * index is the last one. The way-out line appears exactly once, as
 * `buildLossReport`'s own final element, so removing every line equal
 * to it and re-appending it is exact, not approximate.
 */
export const withReportLinesBeforeWayOut = (
	report: ReadonlyArray<string>,
	command: LossReportFacts["command"],
	extraLines: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const wayOut = wayOutLine(command);
	const withoutWayOut = report.filter((line) => line !== wayOut);
	return [...withoutWayOut, ...extraLines, wayOut];
};

/**
 * Every command that uses a catalog reading SHALL print this (delta,
 * "The loss is announced, with the way out"): what was guessed, what
 * was not inferred, every approximation, and the command that removes
 * the loss.
 */
export const buildLossReport = (
	facts: LossReportFacts,
): ReadonlyArray<string> => [
	...guessedLine(facts.roleNames),
	...notInferredLines(
		facts.notInferred,
		facts.standaloneSequences,
		facts.typeLosses,
	),
	...approximationLines(
		facts.uniqueIndexApproximations,
		facts.nextvalDefaults,
		facts.foreignKeyNameApproximations,
		facts.primaryKeyNameApproximations,
	),
	...omittedSchemaLines(facts.omittedSchemas, facts.command),
	...omittedTableLines(facts.omittedTables, facts.command),
	...omittedEnumLines(facts.omittedEnums, facts.command),
	...omittedIndexLines(facts.omittedIndexes, facts.command),
	...omittedCheckLines(facts.omittedChecks, facts.command),
	...omittedForeignKeyLines(facts.omittedForeignKeys, facts.command),
	...omittedForeignKeyColumnLines(
		facts.omittedForeignKeysByColumn,
		facts.command,
	),
	...undeclarableNameLines(facts.undeclarableNameColumns, facts.command),
	wayOutLine(facts.command),
];
