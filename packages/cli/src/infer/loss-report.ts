import { deriveForeignKeyName } from "@hejbro/core";
import type { Catalog } from "../check/catalog";
import type { ColumnLoss } from "./columns";
import type { NotInferredSummary } from "./rest";
import type { InferredTableFacts } from "./table";
import { isExpressibleForeignKeyName } from "./table";

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
 * line said was never inferred at all.
 */
export const detectUniqueIndexApproximations = (
	catalog: Catalog,
	survivingTableIdentities: ReadonlySet<string>,
): ReadonlyArray<UniqueIndexApproximation> =>
	catalog.constraints
		.filter((constraint) => constraint.type === "u")
		.filter((constraint) =>
			survivingTableIdentities.has(`${constraint.schema}.${constraint.table}`),
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
 * stays unexpressed as a declaration (D66).
 */
export const detectNextvalDefaultApproximations = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<NextvalDefaultApproximation> =>
	tables.flatMap((table) =>
		table.columns.flatMap((column) => {
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

/** A column whose SQL name no declaration key can reproduce (CI-G1-R1-06 (C)) -- `import` omits it from the starter file; `pull` never does, its own contract carries every column regardless. */
export type UndeclarableNameColumn = {
	readonly schema: string;
	readonly table: string;
	readonly sqlName: string;
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
 * whose *target* table or schema was itself omitted (D106 R5-B1) --
 * `existingTable(fk.targetSchema, fk.targetTable, …)` would otherwise
 * assert a name the reading already decided it could not carry,
 * aborting the whole reading over a reference into an object one
 * report line up already says is gone. Costs that foreign key alone;
 * the table holding it and everything else on it are still declared.
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
	readonly undeclarableNameColumns: ReadonlyArray<UndeclarableNameColumn>;
	readonly omittedSchemas: ReadonlyArray<OmittedSchema>;
	readonly omittedTables: ReadonlyArray<OmittedTable>;
	readonly omittedIndexes: ReadonlyArray<OmittedIndex>;
	readonly omittedChecks: ReadonlyArray<OmittedCheck>;
	readonly omittedForeignKeys: ReadonlyArray<OmittedForeignKey>;
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
	[...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

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
	EXPRESSION_APPROXIMATION_LINE,
];

/** import's own consequence: the table is left only partly declared, and `check` keeps reporting the column until it is declared by hand or renamed in the database. */
const undeclarableNameLineForImport = (
	column: UndeclarableNameColumn,
): string =>
	`Omitted: column "${column.schema}.${column.table}.${column.sqlName}" -- its SQL name has no declaration key. The table "${column.schema}.${column.table}" is only partly declared, and \`check\` reports this column until it is declared by hand or renamed in the database.`;

/** pull's own consequence (CI-G1-R1-16): `contract/emit.ts` drops any table fact with no matching snapshot node, so a column excluded from the snapshot cannot reach the contract at all, regardless of what the description carries -- `link` is the only way out. */
const undeclarableNameLineForPull = (column: UndeclarableNameColumn): string =>
	`Omitted: column "${column.schema}.${column.table}.${column.sqlName}" -- its SQL name has no declaration key, so it cannot be carried in the contract. Link the schema repository to declare it by hand.`;

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
 * (columns, checks, indexes, foreign keys) goes with it. Unlike an
 * omitted index or check (which `check` never mentions again, see
 * {@link omittedIndexLine}), the table itself keeps surfacing: its own
 * schema is still declared (by its other, expressible tables), so
 * `check`'s own inventory (existence-only, informational, never a
 * failing check) keeps listing it as unmanaged on every run (#707).
 */
const omittedTableConsequenceForImport = (
	stillReportedInInventory: boolean,
): string => {
	if (stillReportedInInventory) {
		return "`check` keeps listing the table itself in its unmanaged-table inventory (informational, never a failing check) until it is renamed in the database.";
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

/**
 * An index's own name is compared by `check`, so declaring it under any
 * other name than the catalog's would leave `check` reporting the
 * declared (wrong) name as missing and the catalog's own name as
 * unmanaged, forever -- the same drift the round-3 foreign-key fix
 * exists to prevent, not reproduce. Omission costs only this index; a
 * vendored contract never carries indexes at all (`contract/emit.ts`),
 * so the two commands share one line. Unlike an omitted table (which
 * `check`'s own inventory keeps naming, see
 * {@link omittedTableConsequenceForImport}), nothing in `check` scans
 * for an index or check no declaration names (#707) -- this run's own
 * report is the only place this omission is ever said out loud.
 */
const omittedIndexLine = (index: OmittedIndex): string =>
	`Omitted: index "${index.schema}.${index.table}.${index.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it under the same name \`check\` would compare it by. hejbro will not mention it again -- \`check\` compares only what is declared, so declare it by hand or rename it in the database.`;

const omittedIndexLines = (
	indexes: ReadonlyArray<OmittedIndex>,
): ReadonlyArray<string> =>
	sortedBy(
		indexes,
		(index) => `${index.schema}.${index.table}.${index.sqlName}`,
	).map(omittedIndexLine);

/** A check constraint's own name is compared by `check` the same way an index's is (see {@link omittedIndexLine}) -- omission costs only this check, and a vendored contract never carries checks either; nothing in `check` scans for one no declaration names, so this run's own report is the only place this omission is ever said out loud (#707). */
const omittedCheckLine = (check: OmittedCheck): string =>
	`Omitted: check constraint "${check.schema}.${check.table}.${check.sqlName}" -- its catalog name is not a valid hejbro SQL identifier, so no declaration can carry it under the same name \`check\` would compare it by. hejbro will not mention it again -- \`check\` compares only what is declared, so declare it by hand or rename it in the database.`;

const omittedCheckLines = (
	checks: ReadonlyArray<OmittedCheck>,
): ReadonlyArray<string> =>
	sortedBy(
		checks,
		(check) => `${check.schema}.${check.table}.${check.sqlName}`,
	).map(omittedCheckLine);

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
 * D106 R5-B1: a foreign key whose own name is fine but whose *target*
 * was omitted -- costs that one foreign key, never the table holding
 * it (which is still declared, minus this one relation) nor the whole
 * reading. Named by the target's own identity and kind, since "which
 * kind of object is missing" changes nothing about *why* — only about
 * what un-omitting it requires.
 */
const omittedForeignKeyLineForImport = (fk: OmittedForeignKey): string =>
	`Omitted: foreign key "${fk.schema}.${fk.table}.${fk.name}" -- references ${fk.targetKind} "${fk.target}", which this reading left out. Next: ${omittedForeignKeyRemedyForImport(fk.targetKind)}`;

const omittedForeignKeyLineForPull = (fk: OmittedForeignKey): string =>
	`Omitted: foreign key "${fk.schema}.${fk.table}.${fk.name}" -- references ${fk.targetKind} "${fk.target}", which this reading left out. ${omittedForeignKeyRemedyForPull(fk.targetKind)}`;

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

const wayOutLine = (command: LossReportFacts["command"]): string => {
	if (command === "pull") {
		return "The loss ends when you link the schema repository.";
	}
	return "The loss ends when you hand-edit the starter declarations.";
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
	),
	...omittedSchemaLines(facts.omittedSchemas, facts.command),
	...omittedTableLines(facts.omittedTables, facts.command),
	...omittedIndexLines(facts.omittedIndexes),
	...omittedCheckLines(facts.omittedChecks),
	...omittedForeignKeyLines(facts.omittedForeignKeys, facts.command),
	...undeclarableNameLines(facts.undeclarableNameColumns, facts.command),
	wayOutLine(facts.command),
];
