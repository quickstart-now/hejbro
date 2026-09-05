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
export type { EnumDeclaration, EnumValues } from "./dsl/pg-enum";
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
	DeclaredTable,
	ForeignKeyAction,
	ForeignKeyDeclaration,
	ForeignKeyInput,
	ForeignKeyReferenceTarget,
	IndexColumnDeclaration,
	IndexColumnOrigin,
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
export { generateMigration, generateMigrations } from "./engine/generate";
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
export type { Aggregated, ReadAs } from "./expr/aggregate";
export { avg, count, max, min, readAsBrand, sum } from "./expr/aggregate";
export type {
	BetweenNode,
	ColumnRef,
	ColumnRefNode,
	ComparisonNode,
	ComparisonOperator,
	Condition,
	CteRefNode,
	DeleteNode,
	ExistsNode,
	Expr,
	ExprNode,
	FromNode,
	FunctionCallNode,
	InListNode,
	InsertNode,
	JoinKind,
	JoinNode,
	LiteralNode,
	LogicalNode,
	NotNode,
	NullsPlacement,
	NullTestNode,
	OnConflictNode,
	OrderByTerm,
	OrderedTerm,
	PlpgsqlRefNode,
	ProjectionNode,
	QueryNode,
	RawSqlNode,
	ReturningNode,
	SelectExprNode,
	SelectNode,
	SetOpNode,
	SqlTemplateChunk,
	SqlTemplateNode,
	TableRefNode,
	UpdateNode,
	WindowNode,
	WithEntryNode,
	WithNode,
} from "./expr/ast";
export {
	columnRef,
	comparisonOperators,
	expr,
	isExpr,
} from "./expr/ast";
export {
	decodeExprNode,
	decodeQueryNode,
	encodeQueryNode,
} from "./expr/codec";
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
export type { BuilderFunctionName, ReadShape } from "./expr/read-shape";
export { BUILDER_READ_SHAPES } from "./expr/read-shape";
export type { DeclaredCteMarker, TableBoundMarker } from "./expr/render-sql";
export {
	collectColumnRefs,
	renderDelete,
	renderExpr,
	renderInsert,
	renderQuery,
	renderSelect,
	renderSelectInto,
	renderSetOp,
	renderTableBoundExpr,
	renderTableRef,
	renderUpdate,
} from "./expr/render-sql";
export type { ClauseTraversal } from "./expr/select-children";
export {
	replaceSelectChildExprs,
	SELECT_CLAUSE_TRAVERSALS,
	selectChildExprs,
} from "./expr/select-children";
export type { SqlInterpolation } from "./expr/sql-template";
export { sql } from "./expr/sql-template";
export type {
	FamilyOfTypeNode,
	LiftableFor,
	SqlTypeFamily,
} from "./expr/type-family";
export { familyOfTypeNode, sqlTypeFamilies } from "./expr/type-family";
export {
	existsChildExprs,
	selectExprChildExprs,
	someDeepExprNode,
} from "./expr/walk";
export type { WindowFunctionCall, WindowSpec } from "./expr/window";
export {
	cumeDist,
	denseRank,
	firstValue,
	lag,
	lastValue,
	lead,
	nthValue,
	ntile,
	over,
	percentRank,
	rank,
	rowNumber,
} from "./expr/window";
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
export { deriveForeignKeyName, tableKind } from "./kinds/table-kind";
export type {
	ColumnSnapshot,
	ForeignKeySnapshot,
	IdentitySnapshot,
	TableSnapshot,
} from "./kinds/table-snapshot";
export {
	columnDefault,
	columnGenerated,
	columnIdentity,
	columnNotNull,
	tableIdentity,
} from "./kinds/table-snapshot";
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
	ExecutableQuery,
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
export type { LeftJoinedBrand, UntrackedJoins } from "./query/left-joined";
export { leftJoinedBrand } from "./query/left-joined";
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
	FromSource,
	NestedReadMarker,
	OrderTermInput,
	SelectDistinctable,
	SelectFiltered,
	SelectGrouped,
	SelectHaving,
	SelectJoinable,
	SelectLimited,
	SelectLimitedThenOffset,
	SelectOffsetted,
	SelectOrdered,
	SelectProjection,
	SetOpBranch,
	SetOpResult,
	SetOpStage,
} from "./query/select";
export {
	exists,
	jsonArrayFrom,
	jsonObjectFrom,
	nestedReadBrand,
	notExists,
	resolveOrderTerm,
	select,
} from "./query/select";
export { assertSameSetOpKeyOrder } from "./query/set-op-key-order";
export type {
	CteBuilder,
	CteEntryOptions,
	CteFieldRef,
	CteReference,
	CteRowEnvironment,
	CteRowMeta,
	WithStage,
} from "./query/with";
export { cteRowMeta, isCteReference, withCte } from "./query/with";
export type { ColumnOrderOracle } from "./snapshot/column-order";
export { computeColumnOrder, noColumnOrder } from "./snapshot/column-order";
export type { Snapshot } from "./snapshot/snapshot";
export {
	buildSnapshot,
	canonicalizeSnapshot,
	emptySnapshot,
	HEJBRO_SNAPSHOT_VERSION,
	parseSnapshot,
	renderSnapshot,
} from "./snapshot/snapshot";
export type { JsonValue } from "./snapshot/stable-json";
export { stableJson } from "./snapshot/stable-json";
export { qualifyName, quoteIdentifier } from "./sql/identifier";
export { assertSqlName, isSqlName } from "./sql/identifier-rules";
export { quoteStringLiteral } from "./sql/literal";
export type {
	BannerHashes,
	DuplicateVersionGroup,
	MigrationPrefixStrategy,
} from "./sql/migration-file";
export {
	deriveExistingTransitionSlug,
	deriveSlug,
	findDuplicateVersionGroups,
	migrationFileName,
	migrationPrefixStrategies,
	migrationVersionOf,
	parseBannerBaseline,
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
export { assertNoNulls } from "./types/assert-no-nulls";
export type {
	BuilderFamily,
	ColumnBuilder,
	ColumnReadType,
	ColumnState,
	NumericMode,
	OriginBrand,
} from "./types/column-builder";
export {
	columnOriginBrand,
	createColumnBuilder,
} from "./types/column-builder";
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
export {
	canonicalizeInterval,
	serializeInterval,
} from "./types/interval-serialize";
export type { BaseTsType, IntervalValue } from "./types/ts-type-map";
export type { SimpleTypeName, TypeNode } from "./types/type-node";
export { renderTypeNode, simpleTypeNames } from "./types/type-node";
