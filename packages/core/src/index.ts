// @hejbro/core — declaration model, builder DSL, compiler, snapshot & diff engine.
// This package is pure: it never touches the filesystem or a database.
// See /docs/specs/2026-08-19-hejbro-design.md before implementing anything here.
//
// Everything below is re-exported from its defining module (grouped here by
// source path, alphabetically, via Biome's import/export organizer); see
// each symbol's own JSDoc at its definition for what it does.

export { captureDeclarationSite } from "./declaration-site";
export type { CheckDeclaration } from "./dsl/check";
export { check } from "./dsl/check";
export type {
	ArgRefs,
	FunctionDeclaration,
	FunctionReturns,
} from "./dsl/define-function";
export { defineFunction } from "./dsl/define-function";
export type {
	TriggerDeclaration,
	TriggerEventInput,
} from "./dsl/define-trigger";
export { defineTrigger } from "./dsl/define-trigger";
export type { ViewDeclaration } from "./dsl/define-view";
export { defineView } from "./dsl/define-view";
export { existingTable } from "./dsl/existing-table";
export type {
	GrantDeclaration,
	GrantSetDeclaration,
	TablePrivilege,
} from "./dsl/grant";
export { grant } from "./dsl/grant";
export type {
	IndexBuilder,
	IndexColumn,
	IndexColumnInput,
} from "./dsl/index-builder";
export { asc, desc, index, op } from "./dsl/index-builder";
export type { EnumDeclaration } from "./dsl/pg-enum";
export { pgEnum } from "./dsl/pg-enum";
export type {
	PolicyCommand,
	PolicyDeclaration,
	PolicyInput,
	RlsDeclaration,
	RlsInput,
} from "./dsl/rls";
export { rls } from "./dsl/rls";
export type { Role } from "./dsl/role";
export { roleName } from "./dsl/role";
export type { SchemaDeclaration } from "./dsl/schema";
export { schema } from "./dsl/schema";
export type {
	ForeignKeyAction,
	ForeignKeyDeclaration,
	ForeignKeyInput,
	ForeignKeyReferenceTarget,
	IndexColumnDeclaration,
	IndexDeclaration,
	IndexMethod,
	IndexNulls,
	Table,
	TableColumns,
	TableDeclaration,
	TableExtras,
} from "./dsl/table";
export {
	foreignKeyActions,
	getTableMeta,
	indexMethods,
	isTable,
	table,
	tableMeta,
	toSnakeCase,
} from "./dsl/table";
export type { ChainEntry, ChainReport } from "./engine/chain";
export { checkChain } from "./engine/chain";
export { diffSnapshots } from "./engine/diff-engine";
export type {
	DuplicateVersionFallbackOption,
	DuplicateVersionFixPlan,
	DuplicateVersionRename,
} from "./engine/duplicate-version-fix";
export {
	duplicateVersionFallbackOptions,
	orderGroupByChain,
	planDuplicateVersionFix,
} from "./engine/duplicate-version-fix";
export type { HejbroInput } from "./engine/generate";
export { generateMigration } from "./engine/generate";
export type { Preset } from "./engine/preset";
export { presetValidators, registerPresets } from "./engine/preset";
export type {
	ColumnRenameAmbiguity,
	ColumnRenameSpec,
	ConfirmDropSpec,
	RenameAmbiguity,
	RenamePlan,
	RenameSpec,
	TableRenameAmbiguity,
	TableRenameSpec,
} from "./engine/rename-plan";
export { planRenames } from "./engine/rename-plan";
export type {
	Diagnostic,
	DiagnosticSeverity,
	Validator,
} from "./engine/validate";
export { diagnostic, runValidators } from "./engine/validate";
export {
	assertNever,
	HejbroError,
	hejbroError,
	throwHejbroError,
} from "./error";
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
	JoinKind,
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
export { decodeExprNode } from "./expr/codec";
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
	literal,
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
export { someDeepExprNode } from "./expr/walk";
export type { KeyedDiff } from "./kind/diff-helpers";
export { diffByKey, sameJson } from "./kind/diff-helpers";
export type {
	ChangeOperation,
	HejbroDeclaration,
	KindChange,
	ObjectKind,
	SerializeContext,
} from "./kind/object-kind";
export { changeOperations } from "./kind/object-kind";
export type { KindRegistry, RegisteredObjectKind } from "./kind/registry";
export {
	createDefaultRegistry,
	createKindRegistry,
	requiredKeysByKind,
} from "./kind/registry";
export { enumKind } from "./kinds/enum-kind";
export type {
	FunctionArgSnapshot,
	FunctionSnapshot,
} from "./kinds/function-kind";
export { functionKind } from "./kinds/function-kind";
export type { GrantSnapshot } from "./kinds/grant-kind";
export { grantKind } from "./kinds/grant-kind";
export type { PolicySnapshot } from "./kinds/policy-kind";
export { policyKind } from "./kinds/policy-kind";
export type { RlsSnapshot } from "./kinds/rls-kind";
export { rlsKind } from "./kinds/rls-kind";
export { schemaKind } from "./kinds/schema-kind";
export type {
	SequenceBaseType,
	SequenceSnapshot,
} from "./kinds/sequence-kind";
export { sequenceKind } from "./kinds/sequence-kind";
export { tableKind } from "./kinds/table-kind";
export type {
	TriggerEventSnapshot,
	TriggerSnapshot,
} from "./kinds/trigger-kind";
export { triggerKind } from "./kinds/trigger-kind";
export type { ViewSnapshot } from "./kinds/view-kind";
export { viewKind } from "./kinds/view-kind";
export type {
	BodyStatement,
	FunctionBody,
	IfBranch,
	PlpgsqlVarDeclaration,
} from "./plpgsql/body-ast";
export type {
	BodyContext,
	IfChain,
	RaiseArg,
	ReturnableQuery,
	RowColumns,
	RowProjection,
	TriggerRow,
} from "./plpgsql/body-context";
export { fnv1aHex } from "./plpgsql/body-hash";
export type { TriggerSnapshotShape } from "./plpgsql/render-body";
export { renderFunctionSql, renderTriggerSql } from "./plpgsql/render-body";
export type {
	DeleteFilterable,
	DeleteFinal,
	DeleteReturnable,
	InsertConflictable,
	InsertFinal,
	InsertReturnable,
	MutationRow,
	MutationValue,
	ReturningProjection,
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
export type { ColumnOrderOracle } from "./snapshot/column-order";
export { computeColumnOrder, noColumnOrder } from "./snapshot/column-order";
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
export type {
	BannerHashes,
	DuplicateVersionGroup,
	MigrationPrefixStrategy,
} from "./sql/migration-file";
export {
	deriveSlug,
	findDuplicateVersionGroups,
	migrationFileName,
	migrationPrefixStrategies,
	migrationVersionOf,
	parseBannerHashes,
	parseBannerVersion,
	renderBanner,
	renderMigrationPrefix,
} from "./sql/migration-file";
export type { SqlStage, SqlStatement } from "./sql/statement";
export {
	deferredStatement,
	predropStatement,
	statement,
} from "./sql/statement";
export type {
	BuilderFamily,
	ColumnBuilder,
	ColumnState,
	NumericMode,
} from "./types/column-builder";
export { createColumnBuilder } from "./types/column-builder";
export type {
	BigintConfig,
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
