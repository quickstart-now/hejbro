import { deriveForeignKeyName, isSqlName } from "@hejbro/core";
import type { Catalog } from "../check/catalog";
import type { ColumnLoss } from "./columns";
import type { NotInferredSummary } from "./rest";
import type { InferredTableFacts } from "./table";

export type UniqueIndexApproximation = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
};

/** Every named UNIQUE table constraint (CI-G1-R1-06 (B), lead-confirmed live: its backing index carries the identical name) -- 1.4's own adapter already reads it only as that index, so this is the report-side half naming the approximation. */
export const detectUniqueIndexApproximations = (
	catalog: Catalog,
): ReadonlyArray<UniqueIndexApproximation> =>
	catalog.constraints
		.filter((constraint) => constraint.type === "u")
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
 * and legality. `infer/table.ts`'s `expressibleForeignKeyName` is this
 * same D36 check's declaration-side half; this is the report-side one,
 * so the two can never drift (`isSqlName`, `@hejbro/core`).
 */
export const detectForeignKeyNameApproximations = (
	tables: ReadonlyArray<InferredTableFacts>,
): ReadonlyArray<ForeignKeyNameApproximation> =>
	tables.flatMap((table) =>
		table.foreignKeys.flatMap((fk) => {
			if (isSqlName(fk.name)) {
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
	...undeclarableNameLines(facts.undeclarableNameColumns, facts.command),
	wayOutLine(facts.command),
];
