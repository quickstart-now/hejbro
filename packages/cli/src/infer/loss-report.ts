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
	...typeLosses.map(
		(loss) =>
			`Not inferred: column "${loss.schema}.${loss.table}.${loss.column}" (type "${loss.sqlType}") -- no column builder expresses it.`,
	),
	...standaloneSequences.map(
		(sequence) =>
			`Not inferred: sequence "${sequence.schema}.${sequence.name}" -- no column owns it, and the DSL has no defineSequence().`,
	),
];

const approximationLines = (
	uniqueIndexApproximations: ReadonlyArray<UniqueIndexApproximation>,
	nextvalDefaults: ReadonlyArray<NextvalDefaultApproximation>,
): ReadonlyArray<string> => [
	...uniqueIndexApproximations.map(
		(approximation) =>
			`Approximated: the UNIQUE constraint "${approximation.schema}.${approximation.table}.${approximation.name}" is inferred as a unique index of the same name -- re-creating it emits \`create unique index\`, not \`add constraint ... unique\`.`,
	),
	...nextvalDefaults.map(
		(nextval) =>
			`Approximated: column "${nextval.schema}.${nextval.table}.${nextval.column}" keeps its \`nextval('${nextval.sequence}')\` default as a raw expression, naming the sequence it does not own.`,
	),
];

/** import only (CI-G1-R1-08 (C)) -- pull's contract carries every column regardless of whether a declaration key can reproduce its SQL name. */
const undeclarableNameLines = (
	columns: ReadonlyArray<UndeclarableNameColumn>,
	command: LossReportFacts["command"],
): ReadonlyArray<string> => {
	if (command !== "import") {
		return [];
	}
	return columns.map(
		(column) =>
			`Omitted: column "${column.schema}.${column.table}.${column.sqlName}" -- its SQL name has no declaration key. The table "${column.schema}.${column.table}" is only partly declared, and \`check\` reports this column until it is declared by hand or renamed in the database.`,
	);
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
	...approximationLines(facts.uniqueIndexApproximations, facts.nextvalDefaults),
	...undeclarableNameLines(facts.undeclarableNameColumns, facts.command),
	wayOutLine(facts.command),
];
