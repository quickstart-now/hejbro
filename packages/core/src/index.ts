// @hejbro/core — declaration model, builder DSL, compiler, snapshot & diff engine.
// This package is pure: it never touches the filesystem or a database.
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.
//
// Everything below is re-exported from its defining module (grouped here by
// source path, alphabetically, via Biome's import/export organizer); see
// each symbol's own JSDoc at its definition for what it does.

export type { IndexBuilder } from "./dsl/index-builder";
export { index } from "./dsl/index-builder";
export type { EnumDeclaration } from "./dsl/pg-enum";
export { pgEnum } from "./dsl/pg-enum";
export type { SchemaDeclaration } from "./dsl/schema";
export { schema } from "./dsl/schema";
export type {
	ForeignKeyAction,
	ForeignKeyDeclaration,
	ForeignKeyInput,
	IndexDeclaration,
	Table,
	TableColumns,
	TableDeclaration,
	TableExtras,
} from "./dsl/table";
export {
	foreignKeyActions,
	getTableMeta,
	isTable,
	table,
	tableMeta,
	toSnakeCase,
} from "./dsl/table";
export { diffSnapshots } from "./engine/diff-engine";
export type { HejbroInput } from "./engine/generate";
export { generateMigration } from "./engine/generate";
export type { HejbroError } from "./error";
export { assertNever, hejbroError, throwHejbroError } from "./error";
export type {
	BetweenNode,
	ColumnRef,
	ColumnRefNode,
	ComparisonNode,
	ComparisonOperator,
	DeleteNode,
	ExistsNode,
	Expr,
	ExprNode,
	FunctionCallNode,
	InListNode,
	InsertNode,
	JoinNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullTestNode,
	OnConflictNode,
	OrderByTerm,
	PlpgsqlRefNode,
	ProjectionNode,
	QueryNode,
	RawSqlNode,
	ReturningNode,
	SelectNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
	UpdateNode,
} from "./expr/ast";
export {
	columnRef,
	comparisonOperators,
	expr,
	isExpr,
} from "./expr/ast";
export { liftLiteral, liftOperand, renderLiteral } from "./expr/literal";
export {
	and,
	between,
	coalesce,
	eq,
	genRandomUuid,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notBetween,
	notIlike,
	notInArray,
	notLike,
	now,
	or,
} from "./expr/operators";
export {
	collectColumnRefs,
	renderDelete,
	renderExpr,
	renderInsert,
	renderQuery,
	renderSelect,
	renderSelectInto,
	renderTableRef,
	renderUpdate,
} from "./expr/render-sql";
export type { SqlInterpolation } from "./expr/sql-template";
export { sql } from "./expr/sql-template";
export type {
	FamilyOfTypeNode,
	LiftableFor,
	SqlTypeFamily,
} from "./expr/type-family";
export { familyOfTypeNode, sqlTypeFamilies } from "./expr/type-family";
export type { KeyedDiff } from "./kind/diff-helpers";
export { diffByKey, sameJson } from "./kind/diff-helpers";
export type {
	ChangeOperation,
	HejbroDeclaration,
	KindChange,
	ObjectKind,
} from "./kind/object-kind";
export { changeOperations } from "./kind/object-kind";
export type { KindRegistry, RegisteredObjectKind } from "./kind/registry";
export { createDefaultRegistry, createKindRegistry } from "./kind/registry";
export { enumKind } from "./kinds/enum-kind";
export { schemaKind } from "./kinds/schema-kind";
export { tableKind } from "./kinds/table-kind";
export type {
	DeleteFilterable,
	DeleteFinal,
	DeleteReturnable,
	InsertConflictable,
	InsertFinal,
	InsertReturnable,
	MutationRow,
	MutationValue,
	UpdateFilterable,
	UpdateFinal,
	UpdateReturnable,
} from "./query/mutate";
export { deleteFrom, insert, update } from "./query/mutate";
export type {
	OrderTermInput,
	SelectFiltered,
	SelectJoinable,
	SelectLimited,
	SelectOrdered,
	SelectProjection,
} from "./query/select";
export { exists, notExists, select } from "./query/select";
export type { Snapshot } from "./snapshot/snapshot";
export {
	buildSnapshot,
	emptySnapshot,
	HEJBRO_SNAPSHOT_VERSION,
	parseSnapshot,
	renderSnapshot,
} from "./snapshot/snapshot";
export type { JsonValue } from "./snapshot/stable-json";
export { stableJson } from "./snapshot/stable-json";
export { qualifyName, quoteIdentifier } from "./sql/identifier";
export { quoteStringLiteral } from "./sql/literal";
export type { MigrationPrefixStrategy } from "./sql/migration-file";
export {
	deriveSlug,
	migrationFileName,
	migrationPrefixStrategies,
	renderBanner,
} from "./sql/migration-file";
export type { SqlStage, SqlStatement } from "./sql/statement";
export { deferredStatement, statement } from "./sql/statement";
export type {
	BuilderFamily,
	ColumnBuilder,
	ColumnState,
} from "./types/column-builder";
export { createColumnBuilder } from "./types/column-builder";
export type {
	CharConfig,
	NumericConfig,
	VarcharConfig,
} from "./types/column-builder-factories";
export {
	bigint,
	bigserial,
	boolean,
	bytea,
	char,
	cidr,
	date,
	doublePrecision,
	inet,
	integer,
	interval,
	json,
	jsonb,
	macaddr,
	numeric,
	real,
	serial,
	smallint,
	smallserial,
	text,
	time,
	timestamp,
	timestamptz,
	timetz,
	uuid,
	varchar,
} from "./types/column-builder-factories";
export type { SimpleTypeName, TypeNode } from "./types/type-node";
export { renderTypeNode, simpleTypeNames } from "./types/type-node";
