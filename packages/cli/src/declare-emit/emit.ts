import type {
	ColumnSnapshot,
	ExprNode,
	ForeignKeyAction,
	ForeignKeySnapshot,
	IdentitySnapshot,
	JsonValue,
	TableSnapshot,
} from "@hejbro/core";
import {
	columnDefault,
	columnGenerated,
	columnIdentity,
	columnNotNull,
	decodeExprNode,
	renderExpr,
	tableIdentity,
} from "@hejbro/core";
import {
	enumsInSnapshot,
	sequencesInSnapshot,
	tablesInSnapshot,
} from "../contract/read-snapshot";
import { resolveIdentifierKeys } from "../infer/column-keys";
import type { InferCatalogResult } from "../infer/compose";
import type { CatalogDescription } from "../infer/description";
import { sqlRawCall } from "./expr-render";
import type { TopoEdge } from "./topo-order";
import { foreignKeyEdgeKey, topologicalTableOrder } from "./topo-order";

/**
 * `TableSnapshot["indexes"]`/`["checks"]`'s own element shapes -- core
 * exports `ColumnSnapshot`/`ForeignKeySnapshot`/`IdentitySnapshot`/
 * `TableSnapshot` but not `IndexSnapshot`/`CheckSnapshot` (core purity:
 * parsing a snapshot node's object keys stays out of the pure surface,
 * `contract/read-snapshot.ts`'s own precedent). Extracted via indexed
 * access rather than hand-restated, so this can never drift from the
 * real shape the way two independently hand-written copies could.
 */
type IndexSnapshotLike = TableSnapshot["indexes"][number];
type IndexColumnSnapshotLike = IndexSnapshotLike["columns"][number];
type CheckSnapshotLike = NonNullable<TableSnapshot["checks"]>[number];

const renderRawExprText = (value: JsonValue): string =>
	renderExpr(decodeExprNode(value) as ExprNode);

/** One-entry array when `value` is set, else empty -- the array-spread shape every optional-field-to-text-fragment site in this module uses, so none of them need a ternary (banned in this codebase). */
const optionalEntry = <T>(
	value: T | null | undefined,
	render: (value: T) => string,
): ReadonlyArray<string> => {
	if (value === null || value === undefined) {
		return [];
	}
	return [render(value)];
};

/** {@link optionalEntry}'s boolean-flag sibling: one entry when `condition` holds. */
const entryWhen = (condition: boolean, text: string): ReadonlyArray<string> => {
	if (!condition) {
		return [];
	}
	return [text];
};

/** `condition ? text : ""` without a ternary. */
const suffixIf = (condition: boolean, text: string): string => {
	if (condition) {
		return text;
	}
	return "";
};

/** `value === undefined ? "" : render(value)` without a ternary. */
const suffixIfDefined = <T>(
	value: T | undefined,
	render: (value: T) => string,
): string => {
	if (value === undefined) {
		return "";
	}
	return render(value);
};

export type DeclareEmitFile = {
	readonly schema: string;
	readonly fileBaseName: string;
	readonly source: string;
};

// ---------------------------------------------------------------------------
// File grouping and safe file names (Q: "only the file name is made safe,
// and the original schema name goes in the loss report").
// ---------------------------------------------------------------------------

const UNSAFE_FILE_CHARACTERS = /[^A-Za-z0-9_-]+/g;

/** A schema name made safe for a file system path -- the schema's own SQL name is untouched everywhere else (the `schema("...")` call argument, table/loss-report text); only the file name is ever adjusted. */
export const safeFileBaseName = (schemaName: string): string => {
	const safe = schemaName.replace(UNSAFE_FILE_CHARACTERS, "_");
	if (safe.length === 0) {
		return "_schema";
	}
	return safe;
};

const groupBySchema = <T extends { readonly schema: string }>(
	rows: ReadonlyArray<T>,
): ReadonlyMap<string, ReadonlyArray<T>> =>
	rows.reduce((map, row) => {
		const existing = map.get(row.schema) ?? [];
		map.set(row.schema, [...existing, row]);
		return map;
	}, new Map<string, ReadonlyArray<T>>());

// ---------------------------------------------------------------------------
// Column type rendering.
// ---------------------------------------------------------------------------

type TypeRender = {
	readonly call: string;
	readonly symbols: ReadonlySet<string>;
};

const SIMPLE_TYPE_SYMBOLS: Readonly<Record<string, string>> = {
	uuid: "uuid",
	text: "text",
	boolean: "boolean",
	smallint: "smallint",
	integer: "integer",
	bigint: "bigint",
	real: "real",
	"double precision": "doublePrecision",
	date: "date",
	time: "time",
	timetz: "timetz",
	timestamp: "timestamp",
	timestamptz: "timestamptz",
	interval: "interval",
	json: "json",
	jsonb: "jsonb",
	bytea: "bytea",
	inet: "inet",
	cidr: "cidr",
	macaddr: "macaddr",
};

const SERIAL_SYMBOL_FOR_BASE: Readonly<Record<string, string>> = {
	smallint: "smallserial",
	integer: "serial",
	bigint: "bigserial",
};

type SequenceFacts = ReturnType<typeof sequencesInSnapshot>;

/** Whether a sequence in `sequences` is owned (D66: identity/serial ownership, `pg_depend` `'i'`/`'a'`) by exactly this column. */
const isSerialOwnedColumn = (
	sequences: SequenceFacts,
	schemaName: string,
	tableName: string,
	columnName: string,
): boolean =>
	sequences.some(
		(sequence) =>
			sequence.schema === schemaName &&
			sequence.table === tableName &&
			sequence.column === columnName,
	);

/** Renders one `TypeNode` (never a `serial`-family name -- table-kind.ts always decomposes those before writing a snapshot, D66) as its builder call, recursing through `array`; `enum` renders as a reference to the enum's own resolved identifier via `enumRef`. */
const renderTypeNode = (
	typeNode: ColumnSnapshot["typeNode"],
	enumRef: (enumSchema: string, enumName: string) => string,
): TypeRender => {
	if (typeNode.typeName === "array") {
		const element = renderTypeNode(typeNode.element, enumRef);
		return {
			call: `${element.call}.array()`,
			symbols: element.symbols,
		};
	}
	if (typeNode.typeName === "enum") {
		return {
			call: `${enumRef(typeNode.enumSchema, typeNode.enumName)}.column()`,
			symbols: new Set(),
		};
	}
	if (typeNode.typeName === "varchar") {
		if (typeNode.length === null) {
			return { call: "varchar()", symbols: new Set(["varchar"]) };
		}
		return {
			call: `varchar({ length: ${typeNode.length} })`,
			symbols: new Set(["varchar"]),
		};
	}
	if (typeNode.typeName === "char") {
		return {
			call: `char({ length: ${typeNode.length} })`,
			symbols: new Set(["char"]),
		};
	}
	if (typeNode.typeName === "numeric") {
		const parts = [
			...optionalEntry(typeNode.precision, (value) => `precision: ${value}`),
			...optionalEntry(typeNode.scale, (value) => `scale: ${value}`),
		];
		if (parts.length === 0) {
			return { call: "numeric()", symbols: new Set(["numeric"]) };
		}
		return {
			call: `numeric({ ${parts.join(", ")} })`,
			symbols: new Set(["numeric"]),
		};
	}
	const symbol = SIMPLE_TYPE_SYMBOLS[typeNode.typeName];
	if (symbol === undefined) {
		throw new Error(
			`declare-emit: unhandled simple type "${typeNode.typeName}"`,
		);
	}
	return { call: `${symbol}()`, symbols: new Set([symbol]) };
};

// ---------------------------------------------------------------------------
// Column builder rendering (fixed chaining order, CI-G2-R1-05/1.3-1.4's own
// proven order: type -> notNull -> unique -> [generated|identity|default] ->
// primaryKey -> references thunk).
// ---------------------------------------------------------------------------

const renderIdentityOptions = (identity: IdentitySnapshot): string => {
	const entries: ReadonlyArray<string> = [
		...optionalEntry(identity.startWith, (value) => `startWith: ${value}`),
		...optionalEntry(identity.increment, (value) => `increment: ${value}`),
		...optionalEntry(identity.minValue, (value) => `minValue: ${value}`),
		...optionalEntry(identity.maxValue, (value) => `maxValue: ${value}`),
		...optionalEntry(identity.cache, (value) => `cache: ${value}`),
		...optionalEntry(identity.cycle, (value) => `cycle: ${value}`),
	];
	if (entries.length === 0) {
		return "";
	}
	return `{ ${entries.join(", ")} }`;
};

const renderGeneratedIdentityOrDefault = (
	column: ColumnSnapshot,
): TypeRender => {
	const generated = columnGenerated(column);
	if (generated !== null) {
		return {
			call: `.generatedAlwaysAs(${sqlRawCall(generated)})`,
			symbols: new Set(["sql"]),
		};
	}
	const identity = columnIdentity(column);
	if (identity !== null && identity.kind === "always") {
		const options = renderIdentityOptions(identity);
		return {
			call: `.generatedAlwaysAsIdentity(${options})`,
			symbols: new Set(),
		};
	}
	if (identity !== null && identity.kind === "by-default") {
		const options = renderIdentityOptions(identity);
		return {
			call: `.generatedByDefaultAsIdentity(${options})`,
			symbols: new Set(),
		};
	}
	const defaultText = columnDefault(column);
	if (defaultText !== null) {
		return {
			call: `.default(${sqlRawCall(defaultText)})`,
			symbols: new Set(["sql"]),
		};
	}
	return { call: "", symbols: new Set() };
};

export type ReferenceThunkTarget = {
	readonly targetIdentifier: string;
	readonly targetColumnTsKey: string;
};

export type ColumnRenderContext = {
	readonly schema: string;
	readonly table: string;
	readonly sequences: ReturnType<typeof sequencesInSnapshot>;
	readonly enumRef: (enumSchema: string, enumName: string) => string;
	/** Present only for the one column whose FK is this graph's cycle-closing edge (2.1, CI-G2-R1-06 Q3) -- composite/action-bearing FKs never reach here (they stay on the `extras` path, matching `.references()`'s own restriction, add-relational-reads). */
	readonly referenceThunk: ReferenceThunkTarget | null;
};

const serialSymbolFor = (
	column: ColumnSnapshot,
	context: ColumnRenderContext,
): string | undefined => {
	if (!(column.typeNode.typeName in SERIAL_SYMBOL_FOR_BASE)) {
		return undefined;
	}
	if (
		!isSerialOwnedColumn(
			context.sequences,
			context.schema,
			context.table,
			column.name,
		)
	) {
		return undefined;
	}
	return SERIAL_SYMBOL_FOR_BASE[column.typeNode.typeName];
};

const renderReferencesThunk = (thunk: ReferenceThunkTarget | null): string => {
	if (thunk === null) {
		return "";
	}
	return `.references(() => ${thunk.targetIdentifier}.${thunk.targetColumnTsKey})`;
};

const renderTypeOrSerial = (
	column: ColumnSnapshot,
	serialSymbol: string | undefined,
	enumRef: (enumSchema: string, enumName: string) => string,
): TypeRender => {
	if (serialSymbol === undefined) {
		return renderTypeNode(column.typeNode, enumRef);
	}
	return { call: `${serialSymbol}()`, symbols: new Set([serialSymbol]) };
};

const renderValuePart = (
	column: ColumnSnapshot,
	serialSymbol: string | undefined,
): TypeRender => {
	if (serialSymbol === undefined) {
		return renderGeneratedIdentityOrDefault(column);
	}
	return { call: "", symbols: new Set<string>() };
};

export const renderColumnBuilder = (
	column: ColumnSnapshot,
	context: ColumnRenderContext,
): TypeRender => {
	const serialSymbol = serialSymbolFor(column, context);

	const typeRender = renderTypeOrSerial(column, serialSymbol, context.enumRef);

	const notNullPart = suffixIf(columnNotNull(column), ".notNull()");
	const uniquePart = suffixIf(column.unique === true, ".unique()");
	const valuePart = renderValuePart(column, serialSymbol);
	const primaryKeyPart = suffixIf(column.primaryKey === true, ".primaryKey()");
	const referencesPart = renderReferencesThunk(context.referenceThunk);

	return {
		call: `${typeRender.call}${notNullPart}${uniquePart}${valuePart.call}${primaryKeyPart}${referencesPart}`,
		symbols: new Set([...typeRender.symbols, ...valuePart.symbols]),
	};
};

// ---------------------------------------------------------------------------
// Index / check rendering.
// ---------------------------------------------------------------------------

const indexColumnBase = (
	column: IndexColumnSnapshotLike,
	tsKeyFor: (sqlName: string) => string,
): TypeRender => {
	if ("expression" in column) {
		return {
			call: sqlRawCall(renderRawExprText(column.expression)),
			symbols: new Set(["sql"]),
		};
	}
	return { call: `t.${tsKeyFor(column.name)}`, symbols: new Set() };
};

const wrapIndexColumnByDirection = (
	base: TypeRender,
	column: IndexColumnSnapshotLike,
): TypeRender => {
	const nulls = column.nulls;
	if (column.desc === true) {
		const options = suffixIfDefined(
			nulls,
			(value) => `, { nulls: ${JSON.stringify(value)} }`,
		);
		return {
			call: `desc(${base.call}${options})`,
			symbols: new Set([...base.symbols, "desc"]),
		};
	}
	if (nulls !== undefined) {
		return {
			call: `asc(${base.call}, { nulls: ${JSON.stringify(nulls)} })`,
			symbols: new Set([...base.symbols, "asc"]),
		};
	}
	return base;
};

const wrapIndexColumnByOpclass = (
	wrapped: TypeRender,
	column: IndexColumnSnapshotLike,
): TypeRender => {
	if (column.opclass === undefined) {
		return wrapped;
	}
	return {
		call: `op(${wrapped.call}, ${JSON.stringify(column.opclass)})`,
		symbols: new Set([...wrapped.symbols, "op"]),
	};
};

const renderIndexColumn = (
	column: IndexColumnSnapshotLike,
	tsKeyFor: (sqlName: string) => string,
): TypeRender =>
	wrapIndexColumnByOpclass(
		wrapIndexColumnByDirection(indexColumnBase(column, tsKeyFor), column),
		column,
	);

const renderIndex = (
	index: IndexSnapshotLike,
	tsKeyFor: (sqlName: string) => string,
): TypeRender => {
	const columnRenders = index.columns.map((column) =>
		renderIndexColumn(column, tsKeyFor),
	);
	const columnsCall = columnRenders.map((render) => render.call).join(", ");
	const uniquePart = suffixIf(index.unique === true, ".unique()");
	const methodPart = suffixIfDefined(
		index.method,
		(method) => `.using(${JSON.stringify(method)})`,
	);
	const wherePart = suffixIfDefined(
		index.where,
		(where) => `.where(${sqlRawCall(renderRawExprText(where))})`,
	);
	const symbols = new Set([
		"index",
		...columnRenders.flatMap((render) => [...render.symbols]),
		...optionalEntry(index.where, () => "sql"),
	]);
	return {
		call: `index(${JSON.stringify(index.name)})${uniquePart}${methodPart}.on(${columnsCall})${wherePart}`,
		symbols,
	};
};

const renderCheck = (check: CheckSnapshotLike): TypeRender => ({
	call: `check(${JSON.stringify(check.name)}, ${sqlRawCall(renderRawExprText(check.expression))})`,
	symbols: new Set(["check", "sql"]),
});

// ---------------------------------------------------------------------------
// Foreign key (extras path) rendering -- every FK except the one cycle-
// closing edge per table (that one is a column-level thunk instead, see
// `renderColumnBuilder`'s `referenceThunk`).
// ---------------------------------------------------------------------------

const FOREIGN_KEY_ACTION_KEYS: ReadonlyArray<
	readonly [keyof Pick<ForeignKeySnapshot, "onDelete" | "onUpdate">, string]
> = [
	["onDelete", "onDelete"],
	["onUpdate", "onUpdate"],
];

const renderForeignKeyActions = (fk: ForeignKeySnapshot): string =>
	FOREIGN_KEY_ACTION_KEYS.map(([field, label]) => {
		const value: ForeignKeyAction | undefined = fk[field];
		if (value === undefined) {
			return "";
		}
		return `, ${label}: ${JSON.stringify(value)}`;
	}).join("");

export type ForeignKeyRenderContext = {
	readonly isSelf: boolean;
	readonly targetIdentifier: string | null;
	readonly tsKeyFor: (sqlName: string) => string;
	readonly targetTsKeyFor: (sqlName: string) => string;
};

const renderReferencesObject = (
	isSelf: boolean,
	targetIdentifier: string | null,
	targetColumns: string,
): string => {
	if (isSelf) {
		return `{ columns: [${targetColumns}] }`;
	}
	return `{ table: ${targetIdentifier}, columns: [${targetColumns}] }`;
};

const renderForeignKey = (
	fk: ForeignKeySnapshot,
	context: ForeignKeyRenderContext,
): string => {
	const columns = fk.columns
		.map((name) => `t.${context.tsKeyFor(name)}`)
		.join(", ");
	const targetColumns = fk.referencesColumns
		.map((name) => {
			if (context.isSelf) {
				return `t.${context.tsKeyFor(name)}`;
			}
			return `${context.targetIdentifier}.${context.targetTsKeyFor(name)}`;
		})
		.join(", ");
	const references = renderReferencesObject(
		context.isSelf,
		context.targetIdentifier,
		targetColumns,
	);
	return `{ columns: [${columns}], references: ${references}${renderForeignKeyActions(fk)} }`;
};

/** Whether `fk` is eligible for the column-level `.references()` thunk (add-relational-reads' own restriction, not a 2.1 choice): single column, no actions. Composite or action-bearing FKs stay on the `extras` path even when they close a cycle. */
const isThunkEligible = (fk: ForeignKeySnapshot): boolean =>
	fk.columns.length === 1 &&
	fk.referencesColumns.length === 1 &&
	fk.onDelete === undefined &&
	fk.onUpdate === undefined;

// ---------------------------------------------------------------------------
// Table rendering.
// ---------------------------------------------------------------------------

export type TableRenderContext = {
	readonly schemaIdentifier: string;
	readonly identifierFor: (tableIdentity: string) => string;
	readonly tsKeyFor: (tableIdentity: string, sqlColumnName: string) => string;
	readonly enumRef: (enumSchema: string, enumName: string) => string;
	readonly sequences: SequenceFacts;
	readonly cycleClosingEdges: ReadonlySet<string>;
};

const isThunkedForeignKey = (
	fk: ForeignKeySnapshot,
	ownIdentity: string,
	cycleClosingEdges: ReadonlySet<string>,
): boolean =>
	fk.referencesTable !== ownIdentity &&
	isThunkEligible(fk) &&
	cycleClosingEdges.has(
		foreignKeyEdgeKey({
			from: ownIdentity,
			to: fk.referencesTable,
			foreignKeyName: fk.name,
		}),
	);

const INDENT = "\t";

const targetIdentifierFor = (
	isSelf: boolean,
	identifierFor: (identity: string) => string,
	referencesTable: string,
): string | null => {
	if (isSelf) {
		return null;
	}
	return identifierFor(referencesTable);
};

const extrasBlockEntry = (
	label: string,
	entries: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (entries.length === 0) {
		return [];
	}
	return [`${INDENT.repeat(2)}${label}: [${entries.join(", ")}],`];
};

const renderExtrasBlock = (extrasEntries: ReadonlyArray<string>): string => {
	if (extrasEntries.length === 0) {
		return "";
	}
	return `,\n${INDENT}(t) => ({\n${extrasEntries.join("\n")}\n${INDENT}})`;
};

export const renderTable = (
	table: TableSnapshot,
	context: TableRenderContext,
): TypeRender => {
	const ownIdentity = tableIdentity(table.schema, table.name);
	const tsKeyForOwn = (sqlName: string) =>
		context.tsKeyFor(ownIdentity, sqlName);

	const thunkedForeignKeys = table.foreignKeys.filter((fk) =>
		isThunkedForeignKey(fk, ownIdentity, context.cycleClosingEdges),
	);
	const extraForeignKeys = table.foreignKeys.filter(
		(fk) => !isThunkedForeignKey(fk, ownIdentity, context.cycleClosingEdges),
	);

	const referenceThunkForColumn = (
		sqlColumnName: string,
	): ReferenceThunkTarget | null => {
		const fk = thunkedForeignKeys.find(
			(candidate) => candidate.columns[0] === sqlColumnName,
		);
		if (fk === undefined) {
			return null;
		}
		const targetColumn = fk.referencesColumns[0];
		if (targetColumn === undefined) {
			return null;
		}
		return {
			targetIdentifier: context.identifierFor(fk.referencesTable),
			targetColumnTsKey: context.tsKeyFor(fk.referencesTable, targetColumn),
		};
	};

	const columnRenders = table.columns.map((column) => ({
		tsKey: tsKeyForOwn(column.name),
		render: renderColumnBuilder(column, {
			schema: table.schema,
			table: table.name,
			sequences: context.sequences,
			enumRef: context.enumRef,
			referenceThunk: referenceThunkForColumn(column.name),
		}),
	}));

	const foreignKeyEntries = extraForeignKeys.map((fk) => {
		const isSelf = fk.referencesTable === ownIdentity;
		return renderForeignKey(fk, {
			isSelf,
			targetIdentifier: targetIdentifierFor(
				isSelf,
				context.identifierFor,
				fk.referencesTable,
			),
			tsKeyFor: tsKeyForOwn,
			targetTsKeyFor: (sqlName: string) =>
				context.tsKeyFor(fk.referencesTable, sqlName),
		});
	});

	const indexRenders = table.indexes.map((index) =>
		renderIndex(index, tsKeyForOwn),
	);
	const checkRenders = (table.checks ?? []).map(renderCheck);

	const columnsObjectText = columnRenders
		.map(({ tsKey, render }) => `${INDENT.repeat(2)}${tsKey}: ${render.call},`)
		.join("\n");

	const extrasEntries: ReadonlyArray<string> = [
		...extrasBlockEntry("foreignKeys", foreignKeyEntries),
		...extrasBlockEntry(
			"indexes",
			indexRenders.map((render) => render.call),
		),
		...extrasBlockEntry(
			"checks",
			checkRenders.map((render) => render.call),
		),
	];

	const extrasText = renderExtrasBlock(extrasEntries);

	const tableIdentifier = context.identifierFor(ownIdentity);
	const call = [
		`export const ${tableIdentifier} = table(`,
		`${INDENT}${context.schemaIdentifier},`,
		`${INDENT}${JSON.stringify(table.name)},`,
		`${INDENT}{`,
		columnsObjectText,
		`${INDENT}}${extrasText},`,
		`);`,
	].join("\n");

	const symbols = new Set([
		"table",
		...columnRenders.flatMap(({ render }) => [...render.symbols]),
		...indexRenders.flatMap((render) => [...render.symbols]),
		...checkRenders.flatMap((render) => [...render.symbols]),
	]);

	return { call, symbols };
};

// ---------------------------------------------------------------------------
// Enum rendering.
// ---------------------------------------------------------------------------

export const enumIdentity = (schemaName: string, enumName: string): string =>
	`${schemaName}.${enumName}`;

const renderEnum = (
	enumFact: {
		readonly schema: string;
		readonly name: string;
		readonly values: ReadonlyArray<string>;
	},
	identifier: string,
	schemaIdentifier: string,
): TypeRender => ({
	call: `export const ${identifier} = pgEnum(${schemaIdentifier}, ${JSON.stringify(enumFact.name)}, ${JSON.stringify([...enumFact.values])});`,
	symbols: new Set(["pgEnum"]),
});

// ---------------------------------------------------------------------------
// Header (2.1, CI-G2-R1-06 Q5 -- exact, lead-approved text; no clock- or
// machine-derived value, ever).
// ---------------------------------------------------------------------------

const HEADER_INTRO = [
	"Generated by `hejbro import` from a database catalog. This file is",
	"this repository's own from now on: edit it by hand — `import` never",
	"rewrites it.",
];

export const renderHeader = (lossReport: ReadonlyArray<string>): string => {
	const introLines = HEADER_INTRO.map((line) => ` * ${line}`);
	if (lossReport.length === 0) {
		return ["/**", ...introLines, " */"].join("\n");
	}
	const reportLines = lossReport.map((line) => ` * ${line}`);
	return ["/**", ...introLines, " *", ...reportLines, " */"].join("\n");
};

// ---------------------------------------------------------------------------
// Top-level orchestration: 1.8's own output in, one file per schema out.
// ---------------------------------------------------------------------------

const buildTsKeyLookup = (
	description: CatalogDescription,
): ((tableIdent: string, sqlName: string) => string) => {
	const byTable = description.tables.reduce((map, described) => {
		const ident = tableIdentity(described.schema, described.table);
		map.set(
			ident,
			new Map(
				described.columns.map(
					(column) => [column.sqlName, column.tsKey] as const,
				),
			),
		);
		return map;
	}, new Map<string, ReadonlyMap<string, string>>());
	return (tableIdent, sqlName) =>
		byTable.get(tableIdent)?.get(sqlName) ?? sqlName;
};

const enumIdentitiesIn = (
	typeNode: ColumnSnapshot["typeNode"],
): ReadonlyArray<string> => {
	if (typeNode.typeName === "array") {
		return enumIdentitiesIn(typeNode.element);
	}
	if (typeNode.typeName === "enum") {
		return [enumIdentity(typeNode.enumSchema, typeNode.enumName)];
	}
	return [];
};

type FilePlan = {
	readonly schemaName: string;
	readonly fileBaseName: string;
	readonly schemaTables: ReadonlyArray<TableSnapshot>;
	readonly schemaEnums: ReturnType<typeof enumsInSnapshot>;
	readonly schemaIdentifier: string;
	readonly enumIdentifiers: ReadonlyMap<string, string>;
	readonly tableIdentifiers: ReadonlyMap<string, string>;
	readonly vocabulary: ReadonlySet<string>;
};

const addToMultiMap = (
	map: Map<string, Set<string>>,
	key: string,
	value: string,
): Map<string, Set<string>> => {
	const existing = map.get(key) ?? new Set<string>();
	existing.add(value);
	map.set(key, existing);
	return map;
};

/**
 * The whole pipeline (2.1): group by schema, order tables by FK topology
 * (global, CI-G2-R1-06 -- ties broken by identity so a different catalog
 * row order can never change a file), resolve one identifier namespace per
 * file (schema + its own enums + its own tables, seeded with that file's
 * own hejbro-vocabulary usage so a table literally named `check` still
 * cannot shadow the imported `check` function), then render.
 *
 * Cross-schema identifier collisions (an imported table/enum name landing
 * on a name this file already resolved locally) are out of this pass's
 * scope -- the settled red case is the vocabulary collision above, not a
 * second collision layer between two schemas' own names.
 */
export const emitDeclarationFiles = (
	result: InferCatalogResult,
): ReadonlyArray<DeclareEmitFile> => {
	const tables = tablesInSnapshot(result.snapshot);
	const enums = enumsInSnapshot(result.snapshot);
	const sequences = sequencesInSnapshot(result.snapshot);
	const tsKeyFor = buildTsKeyLookup(result.description);

	const edges: ReadonlyArray<TopoEdge> = tables.flatMap((table) => {
		const ownIdentity = tableIdentity(table.schema, table.name);
		return table.foreignKeys
			.filter((fk) => fk.referencesTable !== ownIdentity)
			.map((fk) => ({
				from: ownIdentity,
				to: fk.referencesTable,
				foreignKeyName: fk.name,
			}));
	});
	const identities = tables.map((table) =>
		tableIdentity(table.schema, table.name),
	);
	const topo = topologicalTableOrder(identities, edges);
	const orderIndex = new Map(
		topo.order.map((identity, index) => [identity, index] as const),
	);
	const tablesInGlobalOrder = [...tables].sort(
		(a, b) =>
			(orderIndex.get(tableIdentity(a.schema, a.name)) ?? 0) -
			(orderIndex.get(tableIdentity(b.schema, b.name)) ?? 0),
	);

	const tablesBySchema = groupBySchema(tablesInGlobalOrder);
	const enumsBySchema = groupBySchema(enums);
	const schemaNames = [
		...new Set([...tablesBySchema.keys(), ...enumsBySchema.keys()]),
	].sort();

	const filePlans: ReadonlyArray<FilePlan> = schemaNames.map((schemaName) => {
		const schemaTables = tablesBySchema.get(schemaName) ?? [];
		const schemaEnums = enumsBySchema.get(schemaName) ?? [];

		const dryRunContext: TableRenderContext = {
			schemaIdentifier: "schema",
			identifierFor: (id) => id,
			tsKeyFor: (_id, sql) => sql,
			enumRef: () => "enum",
			sequences,
			cycleClosingEdges: topo.cycleClosingEdges,
		};
		const vocabulary = new Set<string>([
			"schema",
			...entryWhen(schemaEnums.length > 0, "pgEnum"),
			...schemaTables.flatMap((table) => [
				...renderTable(table, dryRunContext).symbols,
			]),
		]);

		const names = [
			schemaName,
			...schemaEnums.map((row) => row.name),
			...schemaTables.map((table) => table.name),
		];
		const identifiers = resolveIdentifierKeys(names, vocabulary);
		const schemaIdentifier = identifiers[0] ?? schemaName;
		const enumIdentifiers = new Map(
			schemaEnums.map(
				(row, index) =>
					[
						enumIdentity(row.schema, row.name),
						identifiers[1 + index] ?? row.name,
					] as const,
			),
		);
		const tableIdentifiers = new Map(
			schemaTables.map(
				(table, index) =>
					[
						tableIdentity(table.schema, table.name),
						identifiers[1 + schemaEnums.length + index] ?? table.name,
					] as const,
			),
		);

		return {
			schemaName,
			fileBaseName: safeFileBaseName(schemaName),
			schemaTables,
			schemaEnums,
			schemaIdentifier,
			enumIdentifiers,
			tableIdentifiers,
			vocabulary,
		};
	});

	const fileOfTable = new Map(
		filePlans.flatMap((plan) =>
			plan.schemaTables.map(
				(table) => [tableIdentity(table.schema, table.name), plan] as const,
			),
		),
	);
	const fileOfEnum = new Map(
		filePlans.flatMap((plan) =>
			plan.schemaEnums.map(
				(row) => [enumIdentity(row.schema, row.name), plan] as const,
			),
		),
	);

	const identifierForTable = (identity: string): string =>
		fileOfTable.get(identity)?.tableIdentifiers.get(identity) ?? identity;
	const identifierForEnum = (
		schemaName: string,
		enumNameValue: string,
	): string => {
		const identity = enumIdentity(schemaName, enumNameValue);
		return fileOfEnum.get(identity)?.enumIdentifiers.get(identity) ?? identity;
	};

	return filePlans.map((plan) => {
		const renderContext: TableRenderContext = {
			schemaIdentifier: plan.schemaIdentifier,
			identifierFor: identifierForTable,
			tsKeyFor,
			enumRef: identifierForEnum,
			sequences,
			cycleClosingEdges: topo.cycleClosingEdges,
		};
		const tableTexts = plan.schemaTables.map((table) =>
			renderTable(table, renderContext),
		);
		const enumTexts = plan.schemaEnums.map((row) =>
			renderEnum(
				row,
				plan.enumIdentifiers.get(enumIdentity(row.schema, row.name)) ??
					row.name,
				plan.schemaIdentifier,
			),
		);

		const referencedTableIdentities = plan.schemaTables.flatMap((table) => {
			const ownIdentity = tableIdentity(table.schema, table.name);
			return table.foreignKeys
				.filter((fk) => fk.referencesTable !== ownIdentity)
				.map((fk) => fk.referencesTable);
		});
		const referencedEnumIdentities = plan.schemaTables.flatMap((table) =>
			table.columns.flatMap((column) => enumIdentitiesIn(column.typeNode)),
		);

		const importsByFile = [
			...referencedTableIdentities.map((identity) => ({
				fileBaseName: fileOfTable.get(identity)?.fileBaseName,
				identifier: fileOfTable.get(identity)?.tableIdentifiers.get(identity),
			})),
			...referencedEnumIdentities.map((identity) => ({
				fileBaseName: fileOfEnum.get(identity)?.fileBaseName,
				identifier: fileOfEnum.get(identity)?.enumIdentifiers.get(identity),
			})),
		]
			.filter(
				(
					ref,
				): ref is {
					readonly fileBaseName: string;
					readonly identifier: string;
				} =>
					ref.fileBaseName !== undefined &&
					ref.identifier !== undefined &&
					ref.fileBaseName !== plan.fileBaseName,
			)
			.reduce(
				(map, ref) => addToMultiMap(map, ref.fileBaseName, ref.identifier),
				new Map<string, Set<string>>(),
			);

		const crossFileImportLines = [...importsByFile.keys()]
			.sort()
			.map((fileBaseName) => {
				const identifiers = [...(importsByFile.get(fileBaseName) ?? [])].sort();
				return `import { ${identifiers.join(", ")} } from "./${fileBaseName}.schema";`;
			});

		const hejbroImportLine = `import { ${[...plan.vocabulary].sort().join(", ")} } from "hejbro";`;
		const schemaDeclLine = `export const ${plan.schemaIdentifier} = schema(${JSON.stringify(plan.schemaName)});`;

		const sections: ReadonlyArray<string> = [
			renderHeader(result.lossReport),
			"",
			hejbroImportLine,
			...crossFileImportLines,
			"",
			schemaDeclLine,
			...enumTexts.map((render) => `\n${render.call}`),
			...tableTexts.map((render) => `\n${render.call}`),
		];

		return {
			schema: plan.schemaName,
			fileBaseName: plan.fileBaseName,
			source: `${sections.join("\n")}\n`,
		};
	});
};
