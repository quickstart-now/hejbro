import { assertNever, throwHejbroError } from "../error";
import type { JsonValue } from "../snapshot/stable-json";
import type {
	BetweenNode,
	ColumnRefNode,
	ComparisonNode,
	ExistsNode,
	ExprNode,
	FunctionCallNode,
	InListNode,
	JoinKind,
	JoinNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	PlpgsqlRefNode,
	ProjectionNode,
	RawSqlNode,
	SelectExprNode,
	SelectNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
} from "./ast";
import { joinKinds } from "./ast";

/**
 * The serialization boundary between `ExprNode` (and everything reachable
 * from it — `exists()` drags in `SelectNode`'s own `ProjectionNode`/
 * `JoinNode`/`OrderByTerm`/`TableRefNode`) and its snapshot representation
 * (D67/D70). Two rules, applied recursively over the whole subtree:
 *
 * - Every discriminator *value* (never the field name — `nodeKind`,
 *   `projectionKind`, `joinKind`, `queryKind`, `literalKind`, `chunkKind`
 *   all stay camelCase *keys*) is kebab-case in the snapshot, camelCase in
 *   the TypeScript union (D70).
 * - Every field that names another schema/table/function object takes
 *   D57's vocabulary (`schemaName`→`schema`, `tableName`→`table`,
 *   `columnName`→`column`, `functionName`→`function`).
 *
 * Two things are deliberately NOT touched, both confirmed against real
 * producer/consumer code before this file was written (#110 items 2–4,
 * 17):
 * - SQL's own tokens — `ComparisonNode.operator` (`"not like"`, spaces
 *   included) and `OrderByTerm.direction` (`asc`/`desc`) — are stored
 *   verbatim (D36). Kebab-casing `"not like"` would render SQL Postgres
 *   rejects.
 * - `PlpgsqlRefNode.path` is a local variable path (`new`/`old`, a
 *   function arg, a declared local), never a schema/table/function
 *   reference, so D57's vocabulary rule does not apply to it.
 *
 * `ProjectionNode`'s `allColumns` variant field is renamed
 * `columnNames` → `columns`, matching the existing convention for every
 * other plural column-name-list field in the snapshot
 * (`ForeignKeySnapshot.columns`, `IndexSnapshot.columns`) — D70 doesn't
 * name it explicitly, but the precedent is unambiguous.
 */

// --- discriminator value maps (camelCase <-> kebab-case) ---------------

export const NODE_KIND_TO_SNAPSHOT: Readonly<
	Record<ExprNode["nodeKind"], string>
> = {
	literal: "literal",
	columnRef: "column-ref",
	plpgsqlRef: "plpgsql-ref",
	comparison: "comparison",
	logical: "logical",
	not: "not",
	nullTest: "null-test",
	inList: "in-list",
	between: "between",
	functionCall: "function-call",
	sqlTemplate: "sql-template",
	rawSql: "raw-sql",
	exists: "exists",
	selectExpr: "select-expr",
};

const NODE_KIND_FROM_SNAPSHOT: Readonly<Record<string, ExprNode["nodeKind"]>> =
	Object.fromEntries(
		Object.entries(NODE_KIND_TO_SNAPSHOT).map(([camel, kebab]) => [
			kebab,
			camel as ExprNode["nodeKind"],
		]),
	);

export const PROJECTION_KIND_TO_SNAPSHOT: Readonly<
	Record<ProjectionNode["projectionKind"], string>
> = {
	allColumns: "all-columns",
	columns: "columns",
	constantOne: "constant-one",
};

const PROJECTION_KIND_FROM_SNAPSHOT: Readonly<
	Record<string, ProjectionNode["projectionKind"]>
> = Object.fromEntries(
	Object.entries(PROJECTION_KIND_TO_SNAPSHOT).map(([camel, kebab]) => [
		kebab,
		camel as ProjectionNode["projectionKind"],
	]),
);

const unknownDiscriminator = (kind: string, value: string): never =>
	throwHejbroError(
		"malformed-snapshot-node",
		`hejbro failed while reading a "${kind}" discriminator: unrecognized value "${value}" — this is either a malformed entry in the snapshot file or a bug in hejbro. Next: run \`hejbro verify\` to check whether the snapshot and migration chain agree; if verify passes, the snapshot is intact and this is a hejbro bug — please report it along with the detail above.`,
	);

const asRecord = (
	value: JsonValue,
	kind: string,
): Record<string, JsonValue> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return unknownDiscriminator(kind, JSON.stringify(value));
	}
	return value as Record<string, JsonValue>;
};

const stringField = (node: Record<string, JsonValue>, key: string): string => {
	const value = node[key];
	if (typeof value !== "string") {
		return unknownDiscriminator(key, JSON.stringify(value));
	}
	return value;
};

// --- encode: ExprNode (camelCase) -> snapshot form (kebab + D57 keys) --

/**
 * `LiteralNode["literal"]["literalKind"]` minus `bigint`/`interval`/
 * `array` — the three harden-query-layer #322 added, all mutation-write-
 * value-only (`query/column-value.ts`'s `liftColumnValue`, the only
 * constructor, is never on a declaration path). (F) settled that these
 * three carry canonical *text* for the query-compile pipeline, never that
 * they join the snapshot grammar `codec.ts` speaks — that's D87's own
 * separate, owner-gated decision (a `HEJBRO_SNAPSHOT_VERSION` bump,
 * `snapshot.ts`). `Exclude`-ing them from both handler maps below turns
 * "the declaration path can't construct these kinds" (already proven,
 * `core/test/query/snapshot-reachability.test.ts`) into "and even a
 * hand-built node carrying one is rejected, not silently encoded" — the
 * same class of `tsc`-enforced boundary the `LiftableFor` invariant is.
 */
type SnapshotLiteralKind = Exclude<
	LiteralNode["literal"]["literalKind"],
	"bigint" | "interval" | "array"
>;

/**
 * One handler per {@link SnapshotLiteralKind}, same technique used
 * elsewhere this phase: a mapped type over a closed union, so a missing
 * entry is a compile error. Applied here for coverage, not complexity
 * (#154 ratchet-5): the former `switch`'s `default: assertNever(literal)`
 * was structurally unreachable (this union has exactly these five kinds),
 * so no test could ever reach it.
 */
type EncodeLiteralHandlers = {
	readonly [K in SnapshotLiteralKind]: (
		literal: Extract<LiteralNode["literal"], { readonly literalKind: K }>,
	) => JsonValue;
};

const encodeLiteralHandlers: EncodeLiteralHandlers = {
	string: (literal) => ({ literalKind: "string", value: literal.value }),
	number: (literal) => ({ literalKind: "number", value: literal.value }),
	boolean: (literal) => ({ literalKind: "boolean", value: literal.value }),
	null: () => ({ literalKind: "null" }),
	timestamp: (literal) => ({
		literalKind: "timestamp",
		isoValue: literal.isoValue,
	}),
};

/** `true` for the three query-compile-time-only kinds `SnapshotLiteralKind` excludes — narrows `literal` so the guard clause in {@link encodeLiteral} needs no cast either side of it. */
const isNonSnapshotLiteralKind = (
	literalKind: LiteralNode["literal"]["literalKind"],
): literalKind is "bigint" | "interval" | "array" =>
	literalKind === "bigint" ||
	literalKind === "interval" ||
	literalKind === "array";

/** Builds the `non-snapshot-literal`-coded, enriched plain `Error` this module throws when asked to encode a mutation-write-only literal kind into a declaration-time snapshot — a signal for whoever trips it next, not a currently-reachable path (harden-query-layer #322 Settled Decision (F) covers the query-compile *text* form only, never a snapshot grammar extension, D87's own separate owner gate). */
const throwNonSnapshotLiteral = (literalKind: string): never =>
	throwHejbroError(
		"non-snapshot-literal",
		`literal kind "${literalKind}" is query-compile-time-only (a mutation write value) and can never appear in a declaration-time snapshot. Next: if you're seeing this, the declaration path (.default()/a comparison operator) has started constructing this literal kind — that requires a snapshot format-version bump (HEJBRO_SNAPSHOT_VERSION, snapshot.ts) approved by the project owner (D87) before it can be encoded here.`,
	);

const encodeLiteral = (literal: LiteralNode["literal"]): JsonValue => {
	if (isNonSnapshotLiteralKind(literal.literalKind)) {
		return throwNonSnapshotLiteral(literal.literalKind);
	}
	const handler = encodeLiteralHandlers[literal.literalKind] as (
		literal: LiteralNode["literal"],
	) => JsonValue;
	return handler(literal);
};

const encodeColumnRef = (node: ColumnRefNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.columnRef,
	schema: node.schemaName,
	table: node.tableName,
	column: node.columnName,
});

const encodePlpgsqlRef = (node: PlpgsqlRefNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.plpgsqlRef,
	path: node.path,
});

const encodeComparison = (node: ComparisonNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.comparison,
	operator: node.operator,
	left: encodeExprNode(node.left),
	right: encodeExprNode(node.right),
});

const encodeNot = (node: NotNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.not,
	operand: encodeExprNode(node.operand),
});

const encodeNullTest = (node: NullTestNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.nullTest,
	negated: node.negated,
	operand: encodeExprNode(node.operand),
});

const encodeInList = (node: InListNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.inList,
	negated: node.negated,
	operand: encodeExprNode(node.operand),
	values: node.values.map(encodeExprNode),
});

const encodeBetween = (node: BetweenNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.between,
	negated: node.negated,
	operand: encodeExprNode(node.operand),
	lowerBound: encodeExprNode(node.lowerBound),
	upperBound: encodeExprNode(node.upperBound),
});

const encodeFunctionCall = (node: FunctionCallNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.functionCall,
	schema: node.schemaName,
	function: node.functionName,
	args: node.args.map(encodeExprNode),
});

const encodeSqlTemplateChunk = (chunk: SqlTemplateChunk): JsonValue => {
	switch (chunk.chunkKind) {
		case "text":
			return { chunkKind: "text", text: chunk.text };
		case "expr":
			return { chunkKind: "expr", expr: encodeExprNode(chunk.expr) };
		default:
			return assertNever(chunk);
	}
};

const encodeSqlTemplate = (node: SqlTemplateNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.sqlTemplate,
	chunks: node.chunks.map(encodeSqlTemplateChunk),
});

const encodeRawSql = (node: RawSqlNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.rawSql,
	sql: node.sql,
});

/** `mode` values serialize kebab-case like every discriminator (D57/D70). */
const SELECT_EXPR_MODE_TO_SNAPSHOT: Readonly<
	Record<SelectExprNode["mode"], string>
> = {
	jsonArray: "json-array",
	jsonObject: "json-object",
};

const SELECT_EXPR_MODE_FROM_SNAPSHOT: Readonly<
	Record<string, SelectExprNode["mode"]>
> = Object.fromEntries(
	Object.entries(SELECT_EXPR_MODE_TO_SNAPSHOT).map(([camel, kebab]) => [
		kebab,
		camel as SelectExprNode["mode"],
	]),
);

const encodeSelectExprNode = (node: SelectExprNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.selectExpr,
	mode: SELECT_EXPR_MODE_TO_SNAPSHOT[node.mode],
	query: encodeSelectNode(node.query),
});

const encodeExists = (node: ExistsNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.exists,
	negated: node.negated,
	query: encodeSelectNode(node.query),
});

const encodeLiteralNode = (node: LiteralNode): JsonValue => ({
	nodeKind: "literal",
	literal: encodeLiteral(node.literal),
});

const encodeLogicalNode = (node: LogicalNode): JsonValue => ({
	nodeKind: "logical",
	operator: node.operator,
	operands: node.operands.map(encodeExprNode),
});

/**
 * One handler per {@link ExprNode} `nodeKind` for {@link encodeExprNode} —
 * a mapped type over the full `nodeKind` union, not a hand-written list,
 * so a missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(node)` would have been (verified directly with a
 * scratch dummy-variant edit, #154 PR2).
 */
type EncodeExprNodeHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Extract<ExprNode, { readonly nodeKind: K }>,
	) => JsonValue;
};

const encodeExprNodeHandlers: EncodeExprNodeHandlers = {
	literal: encodeLiteralNode,
	columnRef: encodeColumnRef,
	plpgsqlRef: encodePlpgsqlRef,
	comparison: encodeComparison,
	logical: encodeLogicalNode,
	not: encodeNot,
	nullTest: encodeNullTest,
	inList: encodeInList,
	between: encodeBetween,
	functionCall: encodeFunctionCall,
	sqlTemplate: encodeSqlTemplate,
	rawSql: encodeRawSql,
	exists: encodeExists,
	selectExpr: encodeSelectExprNode,
};

/** @internal exported for {@link decodeExprNode}'s exhaustive-map symmetry and for tests. */
export const encodeExprNode = (node: ExprNode): JsonValue => {
	const handler = encodeExprNodeHandlers[node.nodeKind] as (
		node: ExprNode,
	) => JsonValue;
	return handler(node);
};

const encodeTableRef = (node: TableRefNode): JsonValue => ({
	schema: node.schemaName,
	table: node.tableName,
});

const encodeProjection = (node: ProjectionNode): JsonValue => {
	switch (node.projectionKind) {
		case "allColumns":
			return {
				projectionKind: PROJECTION_KIND_TO_SNAPSHOT.allColumns,
				columns: node.columnNames,
			};
		case "columns":
			return {
				projectionKind: PROJECTION_KIND_TO_SNAPSHOT.columns,
				columns: node.columns.map((entry) => ({
					alias: entry.alias,
					expr: encodeExprNode(entry.expr),
				})),
			};
		case "constantOne":
			return { projectionKind: PROJECTION_KIND_TO_SNAPSHOT.constantOne };
		default:
			return assertNever(node);
	}
};

const encodeJoin = (node: JoinNode): JsonValue => ({
	joinKind: node.joinKind,
	table: encodeTableRef(node.table),
	on: encodeExprNode(node.on),
});

const encodeOrderByTerm = (term: OrderByTerm): JsonValue => ({
	expr: encodeExprNode(term.expr),
	direction: term.direction,
});

const encodeWhere = (where: ExprNode | null): JsonValue => {
	if (where === null) {
		return null;
	}
	return encodeExprNode(where);
};

/**
 * Encodes a whole {@link SelectNode} to its snapshot form. Not
 * `exists()`-specific — this is what lets #157 (view snapshots) reuse it
 * unchanged for a top-level query, not just one nested inside an
 * `ExistsNode`.
 */
export const encodeSelectNode = (node: SelectNode): JsonValue => ({
	queryKind: node.queryKind,
	projection: encodeProjection(node.projection),
	from: encodeTableRef(node.from),
	joins: node.joins.map(encodeJoin),
	where: encodeWhere(node.where),
	orderBy: node.orderBy.map(encodeOrderByTerm),
	limit: node.limit,
});

// --- decode: snapshot form -> ExprNode (camelCase) ----------------------

const decodeLiteralNode = (node: Record<string, JsonValue>): LiteralNode => ({
	nodeKind: "literal",
	literal: decodeLiteral(node.literal as JsonValue),
});

const decodeColumnRefNode = (
	node: Record<string, JsonValue>,
): ColumnRefNode => ({
	nodeKind: "columnRef",
	schemaName: stringField(node, "schema"),
	tableName: stringField(node, "table"),
	columnName: stringField(node, "column"),
});

const decodePlpgsqlRefNode = (
	node: Record<string, JsonValue>,
): PlpgsqlRefNode => ({
	nodeKind: "plpgsqlRef",
	path: (node.path as ReadonlyArray<string>) ?? [],
});

const decodeComparisonNode = (
	node: Record<string, JsonValue>,
): ComparisonNode => ({
	nodeKind: "comparison",
	operator: node.operator as ComparisonNode["operator"],
	left: decodeExprNode(node.left as JsonValue),
	right: decodeExprNode(node.right as JsonValue),
});

const decodeLogicalNode = (node: Record<string, JsonValue>): LogicalNode => ({
	nodeKind: "logical",
	operator: node.operator as LogicalNode["operator"],
	operands: (node.operands as ReadonlyArray<JsonValue>).map(decodeExprNode),
});

const decodeNotNode = (node: Record<string, JsonValue>): NotNode => ({
	nodeKind: "not",
	operand: decodeExprNode(node.operand as JsonValue),
});

const decodeNullTestNode = (node: Record<string, JsonValue>): NullTestNode => ({
	nodeKind: "nullTest",
	negated: node.negated as boolean,
	operand: decodeExprNode(node.operand as JsonValue),
});

const decodeInListNode = (node: Record<string, JsonValue>): InListNode => ({
	nodeKind: "inList",
	negated: node.negated as boolean,
	operand: decodeExprNode(node.operand as JsonValue),
	values: (node.values as ReadonlyArray<JsonValue>).map(decodeExprNode),
});

const decodeBetweenNode = (node: Record<string, JsonValue>): BetweenNode => ({
	nodeKind: "between",
	negated: node.negated as boolean,
	operand: decodeExprNode(node.operand as JsonValue),
	lowerBound: decodeExprNode(node.lowerBound as JsonValue),
	upperBound: decodeExprNode(node.upperBound as JsonValue),
});

const decodeFunctionCallNode = (
	node: Record<string, JsonValue>,
): FunctionCallNode => ({
	nodeKind: "functionCall",
	schemaName: (node.schema as string | null) ?? null,
	functionName: stringField(node, "function"),
	args: (node.args as ReadonlyArray<JsonValue>).map(decodeExprNode),
});

const decodeSqlTemplateNode = (
	node: Record<string, JsonValue>,
): SqlTemplateNode => ({
	nodeKind: "sqlTemplate",
	chunks: (node.chunks as ReadonlyArray<JsonValue>).map(decodeSqlTemplateChunk),
});

const decodeRawSqlNode = (node: Record<string, JsonValue>): RawSqlNode => ({
	nodeKind: "rawSql",
	sql: stringField(node, "sql"),
});

const decodeSelectExprNode = (
	node: Record<string, JsonValue>,
): SelectExprNode => ({
	nodeKind: "selectExpr",
	mode:
		SELECT_EXPR_MODE_FROM_SNAPSHOT[node.mode as string] ??
		unknownDiscriminator("mode", JSON.stringify(node.mode)),
	query: decodeSelectNode(node.query as JsonValue),
});

const decodeExistsNode = (node: Record<string, JsonValue>): ExistsNode => ({
	nodeKind: "exists",
	negated: node.negated as boolean,
	query: decodeSelectNode(node.query as JsonValue),
});

/**
 * One handler per {@link ExprNode} `nodeKind` for {@link decodeExprNode} —
 * a mapped type over the full `nodeKind` union, not a hand-written list,
 * so a missing handler is a `tsc` error the same way a `switch`'s
 * `default: assertNever(nodeKind)` would have been (verified directly
 * with a scratch dummy-variant edit, #154 PR2). Every handler takes the
 * same input shape (`Record<string, JsonValue>`, the already-parsed
 * snapshot object) since the input isn't a discriminated union the way
 * the output is — only the return type is narrowed per key.
 */
type DecodeExprNodeHandlers = {
	readonly [K in ExprNode["nodeKind"]]: (
		node: Record<string, JsonValue>,
	) => Extract<ExprNode, { readonly nodeKind: K }>;
};

const decodeExprNodeHandlers: DecodeExprNodeHandlers = {
	literal: decodeLiteralNode,
	columnRef: decodeColumnRefNode,
	plpgsqlRef: decodePlpgsqlRefNode,
	comparison: decodeComparisonNode,
	logical: decodeLogicalNode,
	not: decodeNotNode,
	nullTest: decodeNullTestNode,
	inList: decodeInListNode,
	between: decodeBetweenNode,
	functionCall: decodeFunctionCallNode,
	sqlTemplate: decodeSqlTemplateNode,
	rawSql: decodeRawSqlNode,
	exists: decodeExistsNode,
	selectExpr: decodeSelectExprNode,
};

export const decodeExprNode = (value: JsonValue): ExprNode => {
	const node = asRecord(value, "nodeKind");
	const snapshotKind = stringField(node, "nodeKind");
	const nodeKind = NODE_KIND_FROM_SNAPSHOT[snapshotKind];
	if (nodeKind === undefined) {
		return unknownDiscriminator("nodeKind", snapshotKind);
	}
	const handler = decodeExprNodeHandlers[nodeKind] as (
		node: Record<string, JsonValue>,
	) => ExprNode;
	return handler(node);
};

/**
 * One handler per {@link LiteralNode}'s `literal.literalKind`, same shape
 * as {@link decodeExprNodeHandlers} above but keyed by the discriminator
 * itself (`literalKind` round-trips unchanged, unlike `nodeKind`'s snake-
 * case-on-disk / camelCase-in-memory pair, so there's no
 * `NODE_KIND_FROM_SNAPSHOT`-style remap table here — {@link
 * isKnownLiteralKind} checks membership directly). Applied for coverage,
 * not complexity (#154 ratchet-5): the five real cases were already well
 * covered; only the malformed-input fallback (`unknownDiscriminator`, a
 * real runtime check on unvalidated JSON, unlike a `switch`'s
 * unreachable `assertNever` default) was thin.
 */
type DecodeLiteralHandlers = {
	readonly [K in SnapshotLiteralKind]: (
		node: Record<string, JsonValue>,
	) => Extract<LiteralNode["literal"], { readonly literalKind: K }>;
};

const decodeLiteralHandlers: DecodeLiteralHandlers = {
	string: (node) => ({ literalKind: "string", value: node.value as string }),
	number: (node) => ({ literalKind: "number", value: node.value as number }),
	boolean: (node) => ({
		literalKind: "boolean",
		value: node.value as boolean,
	}),
	null: () => ({ literalKind: "null" }),
	timestamp: (node) => ({
		literalKind: "timestamp",
		isoValue: node.isoValue as string,
	}),
};

/**
 * `true` when `value` is a key `decodeLiteralHandlers` actually carries —
 * a runtime membership check (`in`), not a type-level one, so excluding
 * `bigint`/`interval`/`array` from {@link DecodeLiteralHandlers}'s keys
 * (their `SnapshotLiteralKind` narrowing) makes this function return
 * `false` for all three automatically: no separate exclusion list to keep
 * in sync, and a snapshot node naming one of them falls straight through
 * to {@link decodeLiteral}'s existing `unknownDiscriminator` rejection,
 * the exact same path any other unrecognized `literalKind` already hits.
 */
const isKnownLiteralKind = (value: string): value is SnapshotLiteralKind =>
	value in decodeLiteralHandlers;

const decodeLiteral = (value: JsonValue): LiteralNode["literal"] => {
	const node = asRecord(value, "literalKind");
	const literalKind = stringField(node, "literalKind");
	if (!isKnownLiteralKind(literalKind)) {
		return unknownDiscriminator("literalKind", literalKind);
	}
	return decodeLiteralHandlers[literalKind](node);
};

const decodeSqlTemplateChunk = (value: JsonValue): SqlTemplateChunk => {
	const node = asRecord(value, "chunkKind");
	const chunkKind = stringField(node, "chunkKind");
	switch (chunkKind) {
		case "text":
			return { chunkKind: "text", text: stringField(node, "text") };
		case "expr":
			return {
				chunkKind: "expr",
				expr: decodeExprNode(node.expr as JsonValue),
			};
		default:
			return unknownDiscriminator("chunkKind", chunkKind);
	}
};

const decodeTableRef = (value: JsonValue): TableRefNode => {
	const node = asRecord(value, "table");
	return {
		schemaName: stringField(node, "schema"),
		tableName: stringField(node, "table"),
	};
};

/**
 * One handler per {@link ProjectionNode} `projectionKind`, same technique
 * as {@link decodeExprNodeHandlers} above. Applied for coverage, not
 * complexity (#154 ratchet-5): the former `switch`'s `default:
 * assertNever(projectionKind)` was structurally unreachable (`projectionKind`
 * is already narrowed to this closed union by the
 * `PROJECTION_KIND_FROM_SNAPSHOT` lookup above), so no test could ever
 * reach it.
 */
type DecodeProjectionHandlers = {
	readonly [K in ProjectionNode["projectionKind"]]: (
		node: Record<string, JsonValue>,
	) => Extract<ProjectionNode, { readonly projectionKind: K }>;
};

const decodeProjectionHandlers: DecodeProjectionHandlers = {
	allColumns: (node) => ({
		projectionKind: "allColumns",
		columnNames: (node.columns as ReadonlyArray<string>) ?? [],
	}),
	columns: (node) => ({
		projectionKind: "columns",
		columns: (
			node.columns as ReadonlyArray<{
				readonly alias: string;
				readonly expr: JsonValue;
			}>
		).map((entry) => ({
			alias: entry.alias,
			expr: decodeExprNode(entry.expr),
		})),
	}),
	constantOne: () => ({ projectionKind: "constantOne" }),
};

const decodeProjection = (value: JsonValue): ProjectionNode => {
	const node = asRecord(value, "projectionKind");
	const snapshotKind = stringField(node, "projectionKind");
	const projectionKind = PROJECTION_KIND_FROM_SNAPSHOT[snapshotKind];
	if (projectionKind === undefined) {
		return unknownDiscriminator("projectionKind", snapshotKind);
	}
	const handler = decodeProjectionHandlers[projectionKind] as (
		node: Record<string, JsonValue>,
	) => ProjectionNode;
	return handler(node);
};

const isJoinKind = (value: string): value is JoinKind =>
	(joinKinds as ReadonlyArray<string>).includes(value);

const decodeJoin = (value: JsonValue): JoinNode => {
	const node = asRecord(value, "joinKind");
	const joinKind = stringField(node, "joinKind");
	if (!isJoinKind(joinKind)) {
		return unknownDiscriminator("joinKind", joinKind);
	}
	return {
		joinKind,
		table: decodeTableRef(node.table as JsonValue),
		on: decodeExprNode(node.on as JsonValue),
	};
};

const decodeOrderByTerm = (value: JsonValue): OrderByTerm => {
	const node = asRecord(value, "direction");
	return {
		expr: decodeExprNode(node.expr as JsonValue),
		direction: node.direction as OrderByTerm["direction"],
	};
};

const decodeWhere = (where: JsonValue): ExprNode | null => {
	if (where === null) {
		return null;
	}
	return decodeExprNode(where);
};

/** Decodes a whole {@link SelectNode} from its snapshot form — the counterpart to {@link encodeSelectNode}, equally reusable for a top-level query (#157) as for `exists()`'s nested one. */
export const decodeSelectNode = (value: JsonValue): SelectNode => {
	const node = asRecord(value, "queryKind");
	const queryKind = stringField(node, "queryKind");
	if (queryKind !== "select") {
		return unknownDiscriminator("queryKind", queryKind);
	}
	return {
		queryKind,
		projection: decodeProjection(node.projection as JsonValue),
		from: decodeTableRef(node.from as JsonValue),
		joins: (node.joins as ReadonlyArray<JsonValue>).map(decodeJoin),
		where: decodeWhere(node.where as JsonValue),
		orderBy: (node.orderBy as ReadonlyArray<JsonValue>).map(decodeOrderByTerm),
		limit: node.limit as number | null,
	};
};
