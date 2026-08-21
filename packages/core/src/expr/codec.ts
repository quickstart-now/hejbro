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
	JoinNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OrderByTerm,
	PlpgsqlRefNode,
	ProjectionNode,
	RawSqlNode,
	SelectNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
} from "./ast";

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

/** @internal exported for {@link decodeExprNode}'s exhaustive-switch symmetry and for tests. */
export const encodeExprNode = (node: ExprNode): JsonValue => {
	switch (node.nodeKind) {
		case "literal":
			return { nodeKind: "literal", literal: encodeLiteral(node.literal) };
		case "columnRef":
			return encodeColumnRef(node);
		case "plpgsqlRef":
			return encodePlpgsqlRef(node);
		case "comparison":
			return encodeComparison(node);
		case "logical":
			return {
				nodeKind: "logical",
				operator: node.operator,
				operands: node.operands.map(encodeExprNode),
			};
		case "not":
			return encodeNot(node);
		case "nullTest":
			return encodeNullTest(node);
		case "inList":
			return encodeInList(node);
		case "between":
			return encodeBetween(node);
		case "functionCall":
			return encodeFunctionCall(node);
		case "sqlTemplate":
			return encodeSqlTemplate(node);
		case "rawSql":
			return encodeRawSql(node);
		case "exists":
			return encodeExists(node);
		default:
			return assertNever(node);
	}
};

const encodeLiteral = (literal: LiteralNode["literal"]): JsonValue => {
	switch (literal.literalKind) {
		case "string":
			return { literalKind: "string", value: literal.value };
		case "number":
			return { literalKind: "number", value: literal.value };
		case "boolean":
			return { literalKind: "boolean", value: literal.value };
		case "null":
			return { literalKind: "null" };
		case "timestamp":
			return { literalKind: "timestamp", isoValue: literal.isoValue };
		default:
			return assertNever(literal);
	}
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

const encodeExists = (node: ExistsNode): JsonValue => ({
	nodeKind: NODE_KIND_TO_SNAPSHOT.exists,
	negated: node.negated,
	query: encodeSelectNode(node.query),
});

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
	where: node.where === null ? null : encodeExprNode(node.where),
	orderBy: node.orderBy.map(encodeOrderByTerm),
	limit: node.limit,
});

// --- decode: snapshot form -> ExprNode (camelCase) ----------------------

export const decodeExprNode = (value: JsonValue): ExprNode => {
	const node = asRecord(value, "nodeKind");
	const snapshotKind = stringField(node, "nodeKind");
	const nodeKind = NODE_KIND_FROM_SNAPSHOT[snapshotKind];
	if (nodeKind === undefined) {
		return unknownDiscriminator("nodeKind", snapshotKind);
	}
	switch (nodeKind) {
		case "literal":
			return {
				nodeKind: "literal",
				literal: decodeLiteral(node.literal as JsonValue),
			};
		case "columnRef":
			return {
				nodeKind: "columnRef",
				schemaName: stringField(node, "schema"),
				tableName: stringField(node, "table"),
				columnName: stringField(node, "column"),
			};
		case "plpgsqlRef":
			return {
				nodeKind: "plpgsqlRef",
				path: (node.path as ReadonlyArray<string>) ?? [],
			};
		case "comparison":
			return {
				nodeKind: "comparison",
				operator: node.operator as ComparisonNode["operator"],
				left: decodeExprNode(node.left as JsonValue),
				right: decodeExprNode(node.right as JsonValue),
			};
		case "logical":
			return {
				nodeKind: "logical",
				operator: node.operator as LogicalNode["operator"],
				operands: (node.operands as ReadonlyArray<JsonValue>).map(
					decodeExprNode,
				),
			};
		case "not":
			return {
				nodeKind: "not",
				operand: decodeExprNode(node.operand as JsonValue),
			};
		case "nullTest":
			return {
				nodeKind: "nullTest",
				negated: node.negated as boolean,
				operand: decodeExprNode(node.operand as JsonValue),
			};
		case "inList":
			return {
				nodeKind: "inList",
				negated: node.negated as boolean,
				operand: decodeExprNode(node.operand as JsonValue),
				values: (node.values as ReadonlyArray<JsonValue>).map(decodeExprNode),
			};
		case "between":
			return {
				nodeKind: "between",
				negated: node.negated as boolean,
				operand: decodeExprNode(node.operand as JsonValue),
				lowerBound: decodeExprNode(node.lowerBound as JsonValue),
				upperBound: decodeExprNode(node.upperBound as JsonValue),
			};
		case "functionCall":
			return {
				nodeKind: "functionCall",
				schemaName: (node.schema as string | null) ?? null,
				functionName: stringField(node, "function"),
				args: (node.args as ReadonlyArray<JsonValue>).map(decodeExprNode),
			};
		case "sqlTemplate":
			return {
				nodeKind: "sqlTemplate",
				chunks: (node.chunks as ReadonlyArray<JsonValue>).map(
					decodeSqlTemplateChunk,
				),
			};
		case "rawSql":
			return { nodeKind: "rawSql", sql: stringField(node, "sql") };
		case "exists":
			return {
				nodeKind: "exists",
				negated: node.negated as boolean,
				query: decodeSelectNode(node.query as JsonValue),
			};
		default:
			return assertNever(nodeKind);
	}
};

const decodeLiteral = (value: JsonValue): LiteralNode["literal"] => {
	const node = asRecord(value, "literalKind");
	const literalKind = stringField(node, "literalKind");
	switch (literalKind) {
		case "string":
			return { literalKind: "string", value: node.value as string };
		case "number":
			return { literalKind: "number", value: node.value as number };
		case "boolean":
			return { literalKind: "boolean", value: node.value as boolean };
		case "null":
			return { literalKind: "null" };
		case "timestamp":
			return { literalKind: "timestamp", isoValue: node.isoValue as string };
		default:
			return unknownDiscriminator("literalKind", literalKind);
	}
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

const decodeProjection = (value: JsonValue): ProjectionNode => {
	const node = asRecord(value, "projectionKind");
	const snapshotKind = stringField(node, "projectionKind");
	const projectionKind = PROJECTION_KIND_FROM_SNAPSHOT[snapshotKind];
	if (projectionKind === undefined) {
		return unknownDiscriminator("projectionKind", snapshotKind);
	}
	switch (projectionKind) {
		case "allColumns":
			return {
				projectionKind: "allColumns",
				columnNames: (node.columns as ReadonlyArray<string>) ?? [],
			};
		case "columns":
			return {
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
			};
		case "constantOne":
			return { projectionKind: "constantOne" };
		default:
			return assertNever(projectionKind);
	}
};

const decodeJoin = (value: JsonValue): JoinNode => {
	const node = asRecord(value, "joinKind");
	const joinKind = stringField(node, "joinKind");
	if (joinKind !== "inner") {
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
		where: node.where === null ? null : decodeExprNode(node.where as JsonValue),
		orderBy: (node.orderBy as ReadonlyArray<JsonValue>).map(decodeOrderByTerm),
		limit: node.limit as number | null,
	};
};
