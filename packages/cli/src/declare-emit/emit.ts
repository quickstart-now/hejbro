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
import type { SchemaCrossing } from "./file-cycle";
import { buildSchemaFileGraph } from "./file-cycle";
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
// primaryKey; no `.references()` thunk -- CI-G2-R1-16, it is never a real
// deferral, see `mustDeferForeignKey`'s own doc comment).
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

export type ColumnRenderContext = {
	readonly schema: string;
	readonly table: string;
	readonly sequences: ReturnType<typeof sequencesInSnapshot>;
	readonly enumRef: (enumSchema: string, enumName: string) => string;
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

	return {
		call: `${typeRender.call}${notNullPart}${uniquePart}${valuePart.call}${primaryKeyPart}`,
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
// Foreign key (extras path) rendering -- every FK, whether its own target
// is a real cross-file import, a same-file const, or (c)'s own unexported
// handle (CI-G2-R1-16: `.references()`'s thunk is never used by this
// emitter -- see `mustDeferForeignKey`'s own doc comment).
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

/**
 * Every cycle-closing FK is declared against an unexported `existingTable`
 * handle (CI-G2-R1-16, lead-approved, measured): `.references()`'s own
 * thunk is not a deferral mechanism at all -- `dsl/table.ts`'s
 * `foldColumnReferences` calls it synchronously, once, as part of
 * `table()`'s own construction (core's own doc call this "the thunk's
 * single evaluation point"; #669 tracks the gap between that doc's
 * "import-order safety" language and this actual eagerness, not this
 * piece's to fix). Measured directly, twice: a same-schema (same-file)
 * closing edge thunked crashes with `Cannot access 'x' before
 * initialization` (TDZ -- the target `const` genuinely isn't
 * initialized yet at that textual point), and a cross-schema pair
 * crashes with `Cannot read properties of undefined (reading 'id')`
 * (a live ESM import cycle) in *both* load orders alike, regardless of
 * which side is thunked and which is immediate. A self-reference is
 * unaffected -- it uses the extras callback's own `t`, never a
 * module-level identifier, confirmed loading cleanly. The handle itself
 * generalizes to same-file and cross-file alike: `existingTable` takes
 * its target's schema and table as string literals, never an import.
 * This base name (before this file's own casing+collision pass) is
 * deterministic in the target identity and this FK's own name, so two
 * handles in one file never collide by accident.
 */
export const handleBaseNameFor = (fk: ForeignKeySnapshot): string =>
	`${fk.referencesTable.replace(".", "_")}_${fk.name}_ref`;

/**
 * Whether `fk` must never be an immediate reference (must instead go
 * through a handle, {@link handleBaseNameFor}) -- two different rules,
 * by whether `fk` stays inside one file:
 *
 * - same schema (same file): the table-level topological order's own
 *   closing-edge rule (CI-G2-R1-05) -- a same-module declaration order
 *   problem; a self-reference is never on it.
 * - different schema (different file): `fk`'s own crossing direction is
 *   a *back edge* of the schema-level graph (CI-G2-R1-18, lead-adopted
 *   refinement over R1-16's own first cut: only the back edge a
 *   deterministic DFS over schema names finds needs a handle, not every
 *   crossing on the cycle -- severing that one edge already makes the
 *   remaining import graph acyclic, so the other direction keeps a real,
 *   type-carrying cross-file import).
 */
export const mustDeferForeignKey = (
	table: TableSnapshot,
	fk: ForeignKeySnapshot,
	context: {
		readonly cycleClosingEdges: ReadonlySet<string>;
		readonly targetSchemaOf: (tableIdentity: string) => string | undefined;
		readonly isSchemaCrossingOnBackEdge: (
			table: TableSnapshot,
			fk: ForeignKeySnapshot,
			targetSchema: string,
		) => boolean;
	},
): boolean => {
	const ownIdentity = tableIdentity(table.schema, table.name);
	if (fk.referencesTable === ownIdentity) {
		return false;
	}
	const targetSchema = context.targetSchemaOf(fk.referencesTable);
	if (targetSchema === table.schema) {
		return context.cycleClosingEdges.has(
			foreignKeyEdgeKey({
				from: ownIdentity,
				to: fk.referencesTable,
				foreignKeyName: fk.name,
			}),
		);
	}
	if (targetSchema === undefined) {
		return false;
	}
	return context.isSchemaCrossingOnBackEdge(table, fk, targetSchema);
};

/** One table's own FKs split into the two settled branches (CI-G2-R1-16): handled (every cycle-closing edge, paired with its own handle's base name) and everything else -- self-references, same-schema non-closing references, and a cross-schema reference whose file pair is acyclic -- left on the ordinary `extras` path. */
export type ForeignKeyClassification = {
	readonly isHandled: (fk: ForeignKeySnapshot) => boolean;
	readonly handled: ReadonlyArray<{
		readonly fk: ForeignKeySnapshot;
		readonly handleBaseName: string;
	}>;
};

export const classifyForeignKeys = (
	table: TableSnapshot,
	mustDeferContext: Parameters<typeof mustDeferForeignKey>[2],
): ForeignKeyClassification => {
	const handled = table.foreignKeys
		.filter((fk) => mustDeferForeignKey(table, fk, mustDeferContext))
		.map((fk) => ({ fk, handleBaseName: handleBaseNameFor(fk) }));
	const handledSet = new Set(handled.map((entry) => entry.fk));
	return {
		isHandled: (fk) => handledSet.has(fk),
		handled,
	};
};

// ---------------------------------------------------------------------------
// Table rendering.
// ---------------------------------------------------------------------------

export type TableRenderContext = {
	readonly schemaIdentifier: string;
	readonly identifierFor: (tableIdentity: string) => string;
	readonly tsKeyFor: (tableIdentity: string, sqlColumnName: string) => string;
	readonly enumRef: (enumSchema: string, enumName: string) => string;
	readonly sequences: SequenceFacts;
	/** {@link mustDeferForeignKey}'s own context (CI-G2-R1-11): table-level cycle-closing edges for a same-schema pair, plus file-level (schema-to-schema) reachability for a cross-schema pair. */
	readonly mustDeferContext: Parameters<typeof mustDeferForeignKey>[2];
	/** Every table this run covers, by identity -- (c)'s own handle needs its target's real column types, which a cross-schema reference otherwise never looks up (its target's own file renders those, not this one). */
	readonly tablesByIdentity: ReadonlyMap<string, TableSnapshot>;
	/** Resolved per (owning table identity, FK name) -- (c)'s own unexported `existingTable` handle identifier, seeded into this file's own identifier namespace alongside its schema/enum/table names. */
	readonly handleIdentifierFor: (
		ownIdentity: string,
		foreignKeyName: string,
	) => string;
};

const INDENT = "\t";

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

/** One `foreignKeys` array entry, with the constraint comment (c) carries directly above it -- `null` for every (a)/(b) entry. */
type ForeignKeyEntryRender = {
	readonly text: string;
	readonly comment: string | null;
};

/** (c)'s own constraint (CI-G2-R1-16, lead-approved wording: state the constraint only, never the round's own process history). */
const HANDLE_CONSTRAINT_COMMENT =
	"// Closes a declaration-file cycle -- any live reference to the other table, thunked or immediate, evaluates before that file finishes initializing, so this FK stays on a reference-only handle instead.";

const commentForForeignKeyEntry = (isHandled: boolean): string | null => {
	if (isHandled) {
		return HANDLE_CONSTRAINT_COMMENT;
	}
	return null;
};

/**
 * `foreignKeys: [...]` -- a single line when no entry carries a comment
 * (every existing (a)/(b)-only table), one entry per line with its own
 * comment line above it once any entry does (c) -- never mixed at the
 * granularity of one array literal, since biome doesn't accept a comment
 * inside a single-line array element list either.
 */
const renderForeignKeysBlock = (
	entries: ReadonlyArray<ForeignKeyEntryRender>,
): ReadonlyArray<string> => {
	if (entries.length === 0) {
		return [];
	}
	if (!entries.some((entry) => entry.comment !== null)) {
		return [
			`${INDENT.repeat(2)}foreignKeys: [${entries.map((entry) => entry.text).join(", ")}],`,
		];
	}
	const lines = entries.flatMap((entry) => [
		...optionalEntry(
			entry.comment,
			(comment) => `${INDENT.repeat(3)}${comment}`,
		),
		`${INDENT.repeat(3)}${entry.text},`,
	]);
	return [
		`${INDENT.repeat(2)}foreignKeys: [`,
		...lines,
		`${INDENT.repeat(2)}],`,
	];
};

/** (c)'s own unexported `existingTable` handle (D41) -- carries only the FK's own target columns, matching `infer/table.ts`'s own `referencesFor` (1.4b): a reference-only handle never needs its target's full column set. */
const renderExistingTableHandle = (
	fk: ForeignKeySnapshot,
	handleIdentifier: string,
	targetTable: TableSnapshot | undefined,
	targetTsKeyFor: (sqlName: string) => string,
	enumRef: (enumSchema: string, enumName: string) => string,
): TypeRender => {
	const [fallbackSchema, fallbackTable] = fk.referencesTable.split(".");
	const targetSchema = targetTable?.schema ?? fallbackSchema ?? "";
	const targetTableName = targetTable?.name ?? fallbackTable ?? "";
	const columnRenders = fk.referencesColumns.map((columnName) => {
		const columnSnapshot = targetTable?.columns.find(
			(column) => column.name === columnName,
		);
		if (columnSnapshot === undefined) {
			return {
				key: targetTsKeyFor(columnName),
				render: { call: "text()", symbols: new Set(["text"]) },
			};
		}
		return {
			key: targetTsKeyFor(columnName),
			render: renderTypeNode(columnSnapshot.typeNode, enumRef),
		};
	});
	const columnsObject = columnRenders
		.map(({ key, render }) => `${key}: ${render.call}`)
		.join(", ");
	return {
		call: `const ${handleIdentifier} = existingTable(${JSON.stringify(targetSchema)}, ${JSON.stringify(targetTableName)}, { ${columnsObject} });`,
		symbols: new Set([
			"existingTable",
			...columnRenders.flatMap(({ render }) => [...render.symbols]),
		]),
	};
};

/** Resolves one FK entry's own `references.table` (Q: self -> `null` (the extras path's own self-reference shape); (c) -> its handle's identifier; (a) -> the target's real identifier, same-file or cross-file alike). */
const resolveForeignKeyTargetIdentifier = (
	fk: ForeignKeySnapshot,
	ownIdentity: string,
	isHandled: boolean,
	handleIdentifierForFk: ReadonlyMap<ForeignKeySnapshot, string>,
	identifierFor: (identity: string) => string,
): string | null => {
	if (fk.referencesTable === ownIdentity) {
		return null;
	}
	if (isHandled) {
		return handleIdentifierForFk.get(fk) ?? "";
	}
	return identifierFor(fk.referencesTable);
};

export type TableRender = {
	/** (c)'s own unexported `existingTable` handle declarations -- placed directly before this table's own `export const` block, never exported (loader.ts:196's `Object.entries(moduleNamespace)` only ever sees a module's own exports, so an unexported handle is never read as a second table declaration). */
	readonly preamble: ReadonlyArray<string>;
	readonly call: string;
	readonly symbols: ReadonlySet<string>;
};

export const renderTable = (
	table: TableSnapshot,
	context: TableRenderContext,
): TableRender => {
	const ownIdentity = tableIdentity(table.schema, table.name);
	const tsKeyForOwn = (sqlName: string) =>
		context.tsKeyFor(ownIdentity, sqlName);

	const classification = classifyForeignKeys(table, context.mustDeferContext);

	const columnRenders = table.columns.map((column) => ({
		tsKey: tsKeyForOwn(column.name),
		render: renderColumnBuilder(column, {
			schema: table.schema,
			table: table.name,
			sequences: context.sequences,
			enumRef: context.enumRef,
		}),
	}));

	const handleRenders = classification.handled.map(({ fk }) => {
		const handleIdentifier = context.handleIdentifierFor(ownIdentity, fk.name);
		const targetTable = context.tablesByIdentity.get(fk.referencesTable);
		return {
			fk,
			handleIdentifier,
			render: renderExistingTableHandle(
				fk,
				handleIdentifier,
				targetTable,
				(sqlName) => context.tsKeyFor(fk.referencesTable, sqlName),
				context.enumRef,
			),
		};
	});
	const handleIdentifierForFk = new Map(
		handleRenders.map(
			({ fk, handleIdentifier }) => [fk, handleIdentifier] as const,
		),
	);

	const foreignKeyEntryRenders: ReadonlyArray<ForeignKeyEntryRender> =
		table.foreignKeys.map((fk) => {
			const isSelf = fk.referencesTable === ownIdentity;
			const isHandled = classification.isHandled(fk);
			const text = renderForeignKey(fk, {
				isSelf,
				targetIdentifier: resolveForeignKeyTargetIdentifier(
					fk,
					ownIdentity,
					isHandled,
					handleIdentifierForFk,
					context.identifierFor,
				),
				tsKeyFor: tsKeyForOwn,
				targetTsKeyFor: (sqlName: string) =>
					context.tsKeyFor(fk.referencesTable, sqlName),
			});
			return { text, comment: commentForForeignKeyEntry(isHandled) };
		});

	const indexRenders = table.indexes.map((index) =>
		renderIndex(index, tsKeyForOwn),
	);
	const checkRenders = (table.checks ?? []).map(renderCheck);

	const columnsObjectText = columnRenders
		.map(({ tsKey, render }) => `${INDENT.repeat(2)}${tsKey}: ${render.call},`)
		.join("\n");

	const extrasEntries: ReadonlyArray<string> = [
		...renderForeignKeysBlock(foreignKeyEntryRenders),
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
		...handleRenders.flatMap(({ render }) => [...render.symbols]),
	]);
	const preamble = handleRenders.map(({ render }) => render.call);

	return { preamble, call, symbols };
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

type HandleNeed = {
	readonly ownIdentity: string;
	readonly fk: ForeignKeySnapshot;
	readonly handleBaseName: string;
};

type FilePlan = {
	readonly schemaName: string;
	readonly fileBaseName: string;
	readonly schemaTables: ReadonlyArray<TableSnapshot>;
	readonly schemaEnums: ReturnType<typeof enumsInSnapshot>;
	readonly schemaHandles: ReadonlyArray<HandleNeed>;
	readonly schemaIdentifier: string;
	readonly enumIdentifiers: ReadonlyMap<string, string>;
	readonly tableIdentifiers: ReadonlyMap<string, string>;
	/** Keyed `${ownIdentity} ${foreignKeyName}` -- one per (c) handle this file's own tables need. */
	readonly handleIdentifiers: ReadonlyMap<string, string>;
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

const handleNeedKey = (ownIdentity: string, foreignKeyName: string): string =>
	`${ownIdentity} ${foreignKeyName}`;

/** Every table a cross-schema FK reaches for, except (c)'s own -- a handled FK never imports its target, it declares an unexported local handle instead (CI-G2-R1-08). Both (a) (a plain cross-file reference) and (b) (a thunked one) still need the import: (b)'s thunk text names the target's real identifier directly. */
const neededCrossFileTableReferences = (
	table: TableSnapshot,
	classification: ForeignKeyClassification,
): ReadonlyArray<string> => {
	const ownIdentity = tableIdentity(table.schema, table.name);
	return table.foreignKeys
		.filter(
			(fk) =>
				fk.referencesTable !== ownIdentity && !classification.isHandled(fk),
		)
		.map((fk) => fk.referencesTable);
};

/**
 * One file's own identifier namespace (schema + its enums + its tables +
 * its (c) handles, in that order), resolved against `reserved` -- called
 * twice (CI-G2-R1-07/09): once with only this file's own hejbro-vocabulary
 * usage (phase 1, whose result other files' imports are read from), once
 * more with vocabulary *and* every name this file imports from another
 * file added to `reserved` (phase 2, the actual final identifiers) -- so a
 * table imported from another schema can never be shadowed by a same-named
 * local one (CI-G2-R1-09: two schemas both naming a table `users`, one
 * referencing the other, is an ordinary case, not an edge case).
 */
const resolveFileIdentifiers = (
	schemaName: string,
	schemaEnums: ReturnType<typeof enumsInSnapshot>,
	schemaTables: ReadonlyArray<TableSnapshot>,
	schemaHandles: ReadonlyArray<HandleNeed>,
	reserved: ReadonlySet<string>,
): {
	readonly schemaIdentifier: string;
	readonly enumIdentifiers: ReadonlyMap<string, string>;
	readonly tableIdentifiers: ReadonlyMap<string, string>;
	readonly handleIdentifiers: ReadonlyMap<string, string>;
} => {
	const names = [
		schemaName,
		...schemaEnums.map((row) => row.name),
		...schemaTables.map((table) => table.name),
		...schemaHandles.map((need) => need.handleBaseName),
	];
	const identifiers = resolveIdentifierKeys(names, reserved);
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
	const tableOffset = 1 + schemaEnums.length;
	const tableIdentifiers = new Map(
		schemaTables.map(
			(table, index) =>
				[
					tableIdentity(table.schema, table.name),
					identifiers[tableOffset + index] ?? table.name,
				] as const,
		),
	);
	const handleOffset = tableOffset + schemaTables.length;
	const handleIdentifiers = new Map(
		schemaHandles.map(
			(need, index) =>
				[
					handleNeedKey(need.ownIdentity, need.fk.name),
					identifiers[handleOffset + index] ?? need.handleBaseName,
				] as const,
		),
	);
	return {
		schemaIdentifier,
		enumIdentifiers,
		tableIdentifiers,
		handleIdentifiers,
	};
};

/**
 * The whole pipeline (2.1): group by schema, order tables by FK topology
 * (global, CI-G2-R1-06 -- ties broken by identity so a different catalog
 * row order can never change a file), resolve one identifier namespace per
 * file in two passes (CI-G2-R1-09: a cross-file import must not collide
 * with a name this file already resolved locally, nor the reverse), then
 * render.
 */
export const emitDeclarationFiles = (
	result: InferCatalogResult,
): ReadonlyArray<DeclareEmitFile> => {
	const tables = tablesInSnapshot(result.snapshot);
	const enums = enumsInSnapshot(result.snapshot);
	const sequences = sequencesInSnapshot(result.snapshot);
	const tsKeyFor = buildTsKeyLookup(result.description);
	const tablesByIdentity = new Map(
		tables.map(
			(table) => [tableIdentity(table.schema, table.name), table] as const,
		),
	);

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

	const targetSchemaOf = (identity: string): string | undefined =>
		tablesByIdentity.get(identity)?.schema;

	/**
	 * CI-G2-R1-18/19: only a schema-level *back edge* -- the direction
	 * `file-cycle.ts`'s own deterministic DFS over the schema graph names
	 * -- goes through a handle; the other direction keeps a real
	 * cross-file import, since severing the back edge alone already makes
	 * the remaining import graph acyclic (safety is identical either way;
	 * this one just leaves more real, type-carrying imports in the files
	 * the repository now owns).
	 */
	const schemaCrossings: ReadonlyArray<SchemaCrossing> = tables.flatMap(
		(table) => {
			const ownIdentity = tableIdentity(table.schema, table.name);
			return table.foreignKeys
				.filter((fk) => fk.referencesTable !== ownIdentity)
				.flatMap((fk) => {
					const targetSchema = targetSchemaOf(fk.referencesTable);
					if (targetSchema === undefined || targetSchema === table.schema) {
						return [];
					}
					return [
						{
							fromSchema: table.schema,
							toSchema: targetSchema,
							edgeId: `${ownIdentity} ${fk.name}`,
						},
					];
				});
		},
	);
	const schemaNamesForTopo = [...new Set(tables.map((table) => table.schema))];
	const schemaFileGraph = buildSchemaFileGraph(
		schemaNamesForTopo,
		schemaCrossings,
	);
	const isSchemaCrossingOnBackEdge = (
		table: TableSnapshot,
		fk: ForeignKeySnapshot,
		targetSchema: string,
	): boolean =>
		schemaFileGraph.isBackEdge(
			table.schema,
			targetSchema,
			`${tableIdentity(table.schema, table.name)} ${fk.name}`,
		);

	const mustDeferContext: Parameters<typeof mustDeferForeignKey>[2] = {
		cycleClosingEdges: topo.cycleClosingEdges,
		targetSchemaOf,
		isSchemaCrossingOnBackEdge,
	};

	const classificationByTable = new Map(
		tables.map(
			(table) =>
				[
					tableIdentity(table.schema, table.name),
					classifyForeignKeys(table, mustDeferContext),
				] as const,
		),
	);
	const classificationFor = (table: TableSnapshot): ForeignKeyClassification =>
		classificationByTable.get(tableIdentity(table.schema, table.name)) ?? {
			isHandled: () => false,
			handled: [],
		};

	const tablesBySchema = groupBySchema(tablesInGlobalOrder);
	const enumsBySchema = groupBySchema(enums);
	const schemaNames = [
		...new Set([...tablesBySchema.keys(), ...enumsBySchema.keys()]),
	].sort();

	const dryRunHandleIdentifierFor = (): string => "handle";

	/** Phase 1 (vocabulary-only) or phase 2 (vocabulary + imports) -- same shape, different `reserved`. */
	const buildFilePlan = (
		schemaName: string,
		reserved: (vocabulary: ReadonlySet<string>) => ReadonlySet<string>,
	): FilePlan => {
		const schemaTables = tablesBySchema.get(schemaName) ?? [];
		const schemaEnums = enumsBySchema.get(schemaName) ?? [];
		const schemaHandles: ReadonlyArray<HandleNeed> = schemaTables.flatMap(
			(table) => {
				const ownIdentity = tableIdentity(table.schema, table.name);
				return classificationFor(table).handled.map((entry) => ({
					ownIdentity,
					fk: entry.fk,
					handleBaseName: entry.handleBaseName,
				}));
			},
		);

		const dryRunContext: TableRenderContext = {
			schemaIdentifier: "schema",
			identifierFor: (id) => id,
			tsKeyFor: (_id, sql) => sql,
			enumRef: () => "enum",
			sequences,
			mustDeferContext,
			tablesByIdentity,
			handleIdentifierFor: dryRunHandleIdentifierFor,
		};
		const vocabulary = new Set<string>([
			"schema",
			...entryWhen(schemaEnums.length > 0, "pgEnum"),
			...schemaTables.flatMap((table) => [
				...renderTable(table, dryRunContext).symbols,
			]),
		]);

		const resolved = resolveFileIdentifiers(
			schemaName,
			schemaEnums,
			schemaTables,
			schemaHandles,
			reserved(vocabulary),
		);

		return {
			schemaName,
			fileBaseName: safeFileBaseName(schemaName),
			schemaTables,
			schemaEnums,
			schemaHandles,
			vocabulary,
			...resolved,
		};
	};

	// Phase 1: each file's own names only, no cross-file knowledge yet --
	// other files' imports are read from this result.
	const phase1Plans = schemaNames.map((schemaName) =>
		buildFilePlan(schemaName, (vocabulary) => vocabulary),
	);
	const phase1FileOfTable = new Map(
		phase1Plans.flatMap((plan) =>
			plan.schemaTables.map(
				(table) => [tableIdentity(table.schema, table.name), plan] as const,
			),
		),
	);
	const phase1FileOfEnum = new Map(
		phase1Plans.flatMap((plan) =>
			plan.schemaEnums.map(
				(row) => [enumIdentity(row.schema, row.name), plan] as const,
			),
		),
	);

	/** The phase-1 identifier a table/enum identity's own owning file assigned it, `null` when that owner is this same file (no import, so no name to reserve) or unknown. */
	const phase1ImportedNameFor = (
		identity: string,
		ownerLookup: ReadonlyMap<string, FilePlan>,
		namesLookup: (plan: FilePlan) => ReadonlyMap<string, string>,
		thisFileBaseName: string,
	): string | null => {
		const owner = ownerLookup.get(identity);
		if (owner === undefined || owner.fileBaseName === thisFileBaseName) {
			return null;
		}
		return namesLookup(owner).get(identity) ?? null;
	};

	// Phase 2: reserve every name this file imports from another file's
	// phase-1 result, alongside its own vocabulary, then re-resolve
	// (CI-G2-R1-09: two schemas both naming a table `users`, one importing
	// the other's, must not collide silently).
	const filePlans = schemaNames.map((schemaName) => {
		const phase1 = phase1Plans.find((plan) => plan.schemaName === schemaName);
		const thisFileBaseName =
			phase1?.fileBaseName ?? safeFileBaseName(schemaName);
		const importedNames = (phase1?.schemaTables ?? []).flatMap((table) => [
			...neededCrossFileTableReferences(
				table,
				classificationFor(table),
			).flatMap((identity) =>
				optionalEntry(
					phase1ImportedNameFor(
						identity,
						phase1FileOfTable,
						(plan) => plan.tableIdentifiers,
						thisFileBaseName,
					),
					(name) => name,
				),
			),
			...table.columns.flatMap((column) =>
				enumIdentitiesIn(column.typeNode).flatMap((identity) =>
					optionalEntry(
						phase1ImportedNameFor(
							identity,
							phase1FileOfEnum,
							(plan) => plan.enumIdentifiers,
							thisFileBaseName,
						),
						(name) => name,
					),
				),
			),
		]);
		return buildFilePlan(
			schemaName,
			(vocabulary) => new Set([...vocabulary, ...importedNames]),
		);
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
	const handleIdentifierFor = (
		ownIdentity: string,
		foreignKeyName: string,
	): string => {
		const plan = fileOfTable.get(ownIdentity);
		return (
			plan?.handleIdentifiers.get(handleNeedKey(ownIdentity, foreignKeyName)) ??
			foreignKeyName
		);
	};

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
			mustDeferContext,
			tablesByIdentity,
			handleIdentifierFor,
		};
		const tableRenders = plan.schemaTables.map((table) =>
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

		const referencedTableIdentities = plan.schemaTables.flatMap((table) =>
			neededCrossFileTableReferences(table, classificationFor(table)),
		);
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

		const tableSections = tableRenders.flatMap((render) => [
			...render.preamble.map((line) => `\n${line}`),
			`\n${render.call}`,
		]);

		const sections: ReadonlyArray<string> = [
			renderHeader(result.lossReport),
			"",
			hejbroImportLine,
			...crossFileImportLines,
			"",
			schemaDeclLine,
			...enumTexts.map((render) => `\n${render.call}`),
			...tableSections,
		];

		return {
			schema: plan.schemaName,
			fileBaseName: plan.fileBaseName,
			source: `${sections.join("\n")}\n`,
		};
	});
};
