import type { Table } from "../dsl/table";
import { toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type {
	ColumnRef,
	Condition,
	Expr,
	QueryNode,
	SelectNode,
	TableRefNode,
} from "../expr/ast";
import { expr, isExpr } from "../expr/ast";
import { liftOperand } from "../expr/literal";
import type { SqlTypeFamily } from "../expr/type-family";
import type {
	DeleteFinal,
	InsertFinal,
	ReturningProjection,
	UpdateFinal,
} from "../query/mutate";
import type { SelectLimited } from "../query/select";
import { stableJson } from "../snapshot/stable-json";
import { assertSqlName } from "../sql/identifier-rules";
import type { BuilderFamily } from "../types/column-builder";
import type {
	BodyStatement,
	FunctionBody,
	IfBranch,
	PlpgsqlVarDeclaration,
} from "./body-ast";
import {
	closeRecordingSession,
	markConsumed,
	openRecordingSession,
} from "./recording-session";
import { assertValidLocalName } from "./reserved";
import { isRefusedReturnFamily } from "./return-family";

/** A value `ctx.raise()` accepts for one `%` placeholder. */
export type RaiseArg = Expr | string | number | boolean | Date | null;

/** What `ctx.row()`/`ctx.rowOrNull()` can read a row from: a whole table, or an object of column references. */
export type RowProjection = Table | Record<string, ColumnRef>;

/** The `Expr` fields `ctx.row()`/`ctx.rowOrNull()` return for a given projection. */
export type RowColumns<TProjection extends RowProjection> =
	TProjection extends Table<infer TColumns>
		? { readonly [K in keyof TColumns]: Expr<BuilderFamily<TColumns[K]>> }
		: TProjection extends Record<string, ColumnRef>
			? {
					readonly [K in keyof TProjection]: TProjection[K] extends ColumnRef<
						infer TFamily
					>
						? Expr<TFamily>
						: never;
				}
			: never;

/** The chain returned by `ctx.if()` — `elseIf`/`else` are fixed for this phase (decision A10). */
export type IfChain = {
	readonly elseIf: (condition: Condition, branch: () => void) => IfChain;
	readonly else: (branch: () => void) => void;
};

/**
 * Hides a {@link TriggerRow}'s `new`/`old` identity behind a unique
 * symbol (mirrors `dsl/table.ts`'s `tableMeta` pattern).
 *
 * `Symbol.for`, kept symmetrical with `tableMeta` — but this conversion
 * is defensive, not a fix for a demonstrated live bug: no independently
 * reproducible cross-instance path exists today (phase8-symbol-for,
 * #138, checked directly). A `TriggerRow` is only ever obtainable through
 * the `rows` argument `defineTrigger` itself hands to a trigger body, so
 * a single `defineTrigger` call is always internally self-consistent;
 * and if `target` (the table) came from a *different* instance,
 * `defineTrigger` fails earlier and louder on the table's own
 * (unguarded) `getTableMeta` lookup, before this symbol is ever
 * consulted. `@hejbro/supabase` doesn't use triggers at all currently
 * (checked). Converted anyway: it's the same public-surface,
 * zero-cost-now/breaking-after-publish case as `tableMeta` (D61/D65),
 * and a future consumer of this symbol shouldn't have to ask why only
 * one of the two got the safer form.
 */
export const triggerRowMeta: unique symbol = Symbol.for(
	"hejbro:trigger-row-meta",
);

/** The `new`/`old` row a `defineTrigger` body receives — every column as a plpgsql-local `Expr`. */
export type TriggerRow<TTable extends Table> = {
	readonly [K in keyof TTable as TTable[K] extends ColumnRef
		? K
		: never]: TTable[K] extends ColumnRef<infer TFamily>
		? Expr<TFamily>
		: never;
} & { readonly [triggerRowMeta]: "new" | "old" };

/**
 * What `ctx.return()` accepts besides a trigger row: a select whose
 * projection is the declared table's whole row, or a mutation on that
 * table ending in a bare `.returning()` (#749/D6/D8) -- narrower than
 * #634's own widening, which is what a `returns setof <table>` body
 * needed before this: a projected `.returning({...})` is never the row
 * shape such a function's caller sees (Postgres matches `return query`'s
 * columns positionally, names ignored), so `assertReturnIsWholeRow`
 * refuses it at declaration time regardless of what the type here
 * accepts -- this narrowing is a compile-time head start on that same
 * refusal, not the check itself; a caller that reaches `ctx.return()`
 * with the type bypassed still gets the runtime refusal. The select
 * member's projection narrows to `Table` (dropping the `Record<string,
 * Expr>` half of `SelectProjection`) for the same reason. Names the
 * third, stage argument as `"final"` explicitly (#686) -- `mutate.ts`'s
 * own two-argument default now covers *both* stages (needed so
 * `@hejbro/query`'s existing two-argument sites keep compiling, #686),
 * so naming only `"final"` here, not omitting the argument, is what
 * excludes a mutation that never called `.returning()`
 * (`InsertReturnable`/`UpdateReturnable`/`DeleteReturnable`, stage
 * `"returnable"`) -- `return query …` over a statement with no
 * `RETURNING` clause is invalid plpgsql. `ExecutableQuery` below is the
 * stage-agnostic sibling `ctx.execute()` accepts, unaffected by this
 * narrowing -- a mutation run for its effect never has a whole-row rule
 * to satisfy.
 */
export type ReturnableQuery =
	| SelectLimited<Table>
	| InsertFinal<Table, undefined, "final">
	| UpdateFinal<Table, undefined, "final">
	| DeleteFinal<Table, undefined, "final">;

/**
 * What `ctx.execute()` accepts: the same four query shapes as
 * {@link ReturnableQuery}, but at *either* mutation stage (#686) --
 * `ctx.execute()` runs a statement for its effect, so a mutation that
 * never called `.returning()` is exactly its common case, and one that
 * did is still refused, at declaration time, by
 * `execute-expects-no-returning` (a runtime check on the rendered query,
 * not a type-level one -- both stages compile here on purpose). Uses the
 * bare two-argument form deliberately -- `mutate.ts`'s `TStage` default
 * is already the full `"returnable" | "final"` union, so this is the
 * same shape every pre-existing two-argument mention already had.
 */
export type ExecutableQuery =
	| SelectLimited
	| InsertFinal<Table, ReturningProjection | undefined>
	| UpdateFinal<Table, ReturningProjection | undefined>
	| DeleteFinal<Table, ReturningProjection | undefined>;

/** The recording API a `defineFunction`/`defineTrigger` body callback receives. */
export type BodyContext = {
	readonly row: <TProjection extends RowProjection>(
		query: SelectLimited<TProjection>,
		name?: string,
	) => RowColumns<TProjection>;
	readonly rowOrNull: <TProjection extends RowProjection>(
		query: SelectLimited<TProjection>,
		name?: string,
	) => RowColumns<TProjection>;
	readonly if: (condition: Condition, thenBranch: () => void) => IfChain;
	readonly raise: (message: string, ...args: ReadonlyArray<RaiseArg>) => void;
	readonly return: (value: TriggerRow<Table> | ReturnableQuery | Expr) => void;
	/** Runs a statement for its side effect (#426) — a select renders `perform`, a mutation renders as-is, at either returning stage (#686). */
	readonly execute: (statement: ExecutableQuery) => void;
	readonly forEach: <TProjection extends RowProjection>(
		query: SelectLimited<TProjection>,
		body: (row: RowColumns<TProjection>) => void,
		name?: string,
	) => void;
};

/**
 * `body-context.ts`'s one generic/runtime boundary crossing (mirrors
 * `dsl/table.ts`'s and `query/mutate.ts`'s equivalent casts): a `Table` or
 * plain object's own enumerable keys map straight onto its `ColumnRef`
 * values at runtime, but a generic `RowProjection` can't trace that back
 * through a mapped type.
 */
const asRecord = (value: unknown): Record<string, unknown> =>
	value as Record<string, unknown>;

const isColumnRefValue = (value: unknown): value is ColumnRef =>
	isExpr(value) && "typeNode" in value;

const countPlaceholders = (message: string): number =>
	message.replaceAll("%%", "").split("%").length - 1;

/**
 * A mutable "if" statement under construction: `branches` and
 * `elseStatements` are pushed into / assigned once by `elseIf`/`else` after
 * the statement has already been appended to its frame. Structurally
 * assignable to the public (readonly) {@link BodyStatement} "if" variant,
 * so it can live in the same `frames` stack without a cast.
 */
type IfStatementDraft = {
	readonly stmtKind: "if";
	readonly branches: Array<IfBranch>;
	elseStatements: Array<BodyStatement> | null;
};

/**
 * The mutable state one `createRecordingContext` call threads through
 * every recording function below — extracted so those functions can live
 * at module scope (see the doc comment on {@link createRecordingContext}
 * for why that matters for CRAP, #154 PR2) instead of as closures nested
 * inside it. `identity`/`declaredAt` never change after construction;
 * everything else does, in place, the same way it did as closure-captured
 * locals before this split — only the capture mechanism changed, from
 * lexical scope to an explicit parameter every function here takes first.
 */
/**
 * What the enclosing declaration said it returns — threaded in from
 * `defineFunction`/`defineTrigger` so `ctx.return()` can reject a shape
 * Postgres would reject (#424). Without it the recorder sees only the
 * value, and `return query` in a scalar function compiled silently and
 * failed at apply time with "cannot use RETURN QUERY in a non-SETOF
 * function".
 */
export type ReturnKind = "trigger" | "setofTable" | "scalar";

/** The table a `returns setof <table>` declaration names (#749/D7) — `null` for a trigger or scalar declaration, which has no whole-row shape to check `ctx.return()`'s query against. Threaded in from `defineFunction` the same way {@link ReturnKind} already is; `defineTrigger` passes `null`. */
export type SetofTableIdentity = {
	readonly schemaName: string;
	readonly tableName: string;
} | null;

/**
 * A name a body renders as a plpgsql identifier — an argument's derived
 * SQL name (seeded in from `defineFunction`/`defineTrigger`, task 1.4), a
 * loop's record name, or a row read's derived scalar (`<row>_<col>`). A
 * collision here is one Postgres itself refuses or, worse, silently
 * resolves to the wrong variable, so a rendered name is also
 * reserved-checked (#832/R2).
 */
type RenderedNameKind = "argument" | "loop" | "row local";

/**
 * A name the author gives a body construct — a loop's name, or a row
 * read's own name. A collision here is hejbro's own (two constructs
 * answering to one name in the same body); a row read's name renders
 * nowhere, so it is never reserved-checked. A loop's name is both a
 * rendered identifier and a construct label.
 */
type ConstructNameKind = "loop" | "row read";

type RecordingState = {
	readonly identity: string;
	readonly declaredAt: string | null;
	readonly returnKind: ReturnKind;
	readonly declaredTable: SetofTableIdentity;
	/** The declared scalar `returns` type's family — `null` for a setof or trigger declaration, which returns no scalar expression to check. */
	readonly scalarReturnFamily: SqlTypeFamily | null;
	/** set the moment any return statement is recorded, at any nesting depth — a scalar function that never sets it has no way to produce its value. */
	readonly returned: { current: boolean };
	readonly declarations: Array<PlpgsqlVarDeclaration>;
	readonly renderedNames: Map<string, RenderedNameKind>;
	readonly constructNames: Map<string, ConstructNameKind>;
	readonly frames: Array<Array<BodyStatement>>;
	readonly rowCounter: { current: number };
	readonly loopCounter: { current: number };
};

const currentFrame = (state: RecordingState): Array<BodyStatement> => {
	const frame = state.frames.at(-1);
	if (frame === undefined) {
		return throwHejbroError(
			"unreachable",
			`${state.identity}: plpgsql body recording has an empty frame stack.`,
			state.declaredAt,
		);
	}
	return frame;
};

const popFrame = (state: RecordingState): Array<BodyStatement> => {
	const frame = state.frames.pop();
	if (frame === undefined) {
		return throwHejbroError(
			"unreachable",
			`${state.identity}: plpgsql body recording popped an empty frame stack.`,
			state.declaredAt,
		);
	}
	return frame;
};

const pushStatement = (
	state: RecordingState,
	statement: BodyStatement,
): void => {
	currentFrame(state).push(statement);
};

/** A `duplicate-local-name` message's construct label for one of the two name-space kinds. */
const nameKindLabel = (kind: RenderedNameKind | ConstructNameKind): string => {
	if (kind === "row read") {
		return "row read";
	}
	if (kind === "row local") {
		return "row-declared local";
	}
	return kind;
};

/** Throws `duplicate-local-name`, naming both colliding constructs by kind (#832/R2) — the already-registered owner and the one being registered now. */
const throwNameCollision = (
	state: RecordingState,
	name: string,
	ownerKind: RenderedNameKind | ConstructNameKind,
	requesterKind: RenderedNameKind | ConstructNameKind,
): never =>
	throwHejbroError(
		"duplicate-local-name",
		`${state.identity}: the ${nameKindLabel(ownerKind)} named "${name}" collides with the ${nameKindLabel(requesterKind)} named "${name}" — one name, two constructs. Next: rename one of them.`,
		state.declaredAt,
	);

/**
 * Registers `name` as a rendered plpgsql identifier — a loop record or a
 * row-declared local — checked in order: reserved (folds case, so a
 * mixed-case spelling of an owned name is still caught here, not by the
 * SQL-name check below), hejbro SQL name, then unique among every other
 * rendered name (#832/R2, spec.md's "A body local is a hejbro SQL name
 * and never shadows an argument").
 */
const registerRenderedName = (
	state: RecordingState,
	name: string,
	kind: RenderedNameKind,
	context: string,
): void => {
	assertValidLocalName(name, state.identity, state.declaredAt);
	assertSqlName(name, context, state.declaredAt);
	const owner = state.renderedNames.get(name);
	if (owner !== undefined) {
		throwNameCollision(state, name, owner, kind);
	}
	state.renderedNames.set(name, kind);
};

/**
 * Registers `name` as a construct label — a row read's own name — checked
 * as a hejbro SQL name and for uniqueness among other construct labels,
 * never reserved-checked: the name itself renders nowhere (#832/R2,
 * design.md Q2/Q3).
 */
const registerConstructName = (
	state: RecordingState,
	name: string,
	kind: ConstructNameKind,
	context: string,
): void => {
	assertSqlName(name, context, state.declaredAt);
	const owner = state.constructNames.get(name);
	if (owner !== undefined) {
		throwNameCollision(state, name, owner, kind);
	}
	state.constructNames.set(name, kind);
};

/**
 * A loop's name is both a rendered plpgsql record identifier and a
 * construct label — registered in both spaces, so a collision with
 * either an argument/row-local variable or a row read's own name is
 * caught (design.md Q3). Reserved-checked before the SQL-name check
 * (same order as {@link registerRenderedName}): a loop named `FOUND` or
 * `Row` answers `reserved-local-name`, not `invalid-sql-name`, because
 * lower-casing it would not make it usable.
 */
const registerLoopName = (state: RecordingState, name: string): void => {
	assertValidLocalName(name, state.identity, state.declaredAt);
	assertSqlName(name, `loop in ${state.identity}`, state.declaredAt);
	const renderedOwner = state.renderedNames.get(name);
	if (renderedOwner !== undefined) {
		throwNameCollision(state, name, renderedOwner, "loop");
	}
	const constructOwner = state.constructNames.get(name);
	if (constructOwner !== undefined) {
		throwNameCollision(state, name, constructOwner, "loop");
	}
	state.renderedNames.set(name, "loop");
	state.constructNames.set(name, "loop");
};

const resolveRowEntries = (
	state: RecordingState,
	projectionInput: RowProjection,
): ReadonlyArray<{ readonly key: string; readonly columnRef: ColumnRef }> =>
	Object.entries(asRecord(projectionInput)).map(([key, value]) => {
		if (!isColumnRefValue(value)) {
			return throwHejbroError(
				"row-projection-not-column",
				`ctx.row()/ctx.rowOrNull() projection key "${key}" in ${state.identity} isn't a plain column reference. Next: pass table columns (e.g. table.column), not computed expressions.`,
				state.declaredAt,
			);
		}
		return { key, columnRef: value };
	});

const recordRow =
	(state: RecordingState, strict: boolean) =>
	<TProjection extends RowProjection>(
		query: SelectLimited<TProjection>,
		name?: string,
	): RowColumns<TProjection> => {
		markConsumed(query.selectQuery);
		state.rowCounter.current += 1;
		const rowName = name ?? `row_${state.rowCounter.current}`;
		registerConstructName(
			state,
			rowName,
			"row read",
			`row read in ${state.identity}`,
		);
		const entries = resolveRowEntries(state, query.projectionInput);

		const composed = entries.map((entry) => {
			const varName = `${rowName}_${toSnakeCase(entry.key)}`;
			registerRenderedName(
				state,
				varName,
				"row local",
				`row-declared local in ${state.identity}`,
			);
			state.declarations.push({
				declKind: "scalar",
				name: varName,
				typeNode: entry.columnRef.typeNode,
			});
			return { key: entry.key, varName, family: entry.columnRef.family };
		});

		pushStatement(state, {
			stmtKind: "selectInto",
			query: query.selectQuery,
			strict,
			intoVariables: composed.map((entry) => entry.varName),
		});

		return Object.fromEntries(
			composed.map((entry) => [
				entry.key,
				expr(entry.family, { nodeKind: "plpgsqlRef", path: [entry.varName] }),
			]),
		) as RowColumns<TProjection>;
	};

const makeIfChain = (
	state: RecordingState,
	branches: Array<IfBranch>,
	statement: IfStatementDraft,
): IfChain => ({
	elseIf: (condition, branch) => {
		if (statement.elseStatements !== null) {
			throwHejbroError(
				"invalid-if-chain",
				`ctx.if() chain in ${state.identity} called .elseIf() after .else(). Next: reorder every .elseIf() before the single .else(), or drop the extra branch.`,
				state.declaredAt,
			);
		}
		state.frames.push([]);
		branch();
		const branchStatements = popFrame(state);
		branches.push({
			condition: condition.exprNode,
			statements: branchStatements,
		});
		return makeIfChain(state, branches, statement);
	},
	else: (branch) => {
		if (statement.elseStatements !== null) {
			throwHejbroError(
				"invalid-if-chain",
				`ctx.if() chain in ${state.identity} called .else() more than once — an if/elseIf chain can have at most one .else(). Next: remove the duplicate call.`,
				state.declaredAt,
			);
		}
		state.frames.push([]);
		branch();
		statement.elseStatements = popFrame(state);
	},
});

const recordIf = (
	state: RecordingState,
	condition: Condition,
	thenBranch: () => void,
): IfChain => {
	state.frames.push([]);
	thenBranch();
	const thenStatements = popFrame(state);
	const branches: Array<IfBranch> = [
		{ condition: condition.exprNode, statements: thenStatements },
	];
	const statement: IfStatementDraft = {
		stmtKind: "if",
		branches,
		elseStatements: null,
	};
	pushStatement(state, statement);
	return makeIfChain(state, branches, statement);
};

const recordRaise = (
	state: RecordingState,
	message: string,
	args: ReadonlyArray<RaiseArg>,
): void => {
	const placeholderCount = countPlaceholders(message);
	if (placeholderCount !== args.length) {
		throwHejbroError(
			"raise-arg-count-mismatch",
			`ctx.raise() message in ${state.identity} has ${placeholderCount} "%" placeholder(s) but received ${args.length} argument(s) ("%%" renders as a literal percent sign). Next: add the missing argument(s) to ctx.raise(), or remove the extra "%" placeholder(s) from the message.`,
			state.declaredAt,
		);
	}
	pushStatement(state, {
		stmtKind: "raise",
		message,
		args: args.map((arg) => liftOperand(arg, "unknown")),
	});
};

const isTriggerRow = (value: unknown): value is TriggerRow<Table> =>
	typeof value === "object" && value !== null && triggerRowMeta in value;

/**
 * Extracts the `QueryNode` a {@link ReturnableQuery}/{@link ExecutableQuery}
 * value carries, by which of its four own fields is present — shared by
 * {@link recordReturnShape} and {@link recordExecute} so the same
 * four-way dispatch isn't repeated. Takes the wider `ExecutableQuery`
 * (both mutation stages, #686) since `recordExecute` accepts either
 * stage; `recordReturnShape`'s own `ReturnableQuery` argument is always a
 * narrower, compatible value. Returns `null` only for a value matching
 * none of the four shapes — structurally unreachable for a type-correct
 * caller (each member of both unions carries exactly one of these keys),
 * the same class of gap a `switch`'s `default: assertNever(...)` leaves
 * elsewhere in this codebase, kept here as a real `null` (not a throw) so
 * each caller decides what "no shape matched" means for itself.
 */
const returnableQueryNode = (value: ExecutableQuery): QueryNode | null => {
	if ("selectQuery" in value) {
		return value.selectQuery;
	}
	if ("insertQuery" in value) {
		return value.insertQuery;
	}
	if ("updateQuery" in value) {
		return value.updateQuery;
	}
	if ("deleteQuery" in value) {
		return value.deleteQuery;
	}
	return null;
};

/**
 * Refuses a mutation `QueryNode` that carries `.returning()` — plpgsql's
 * `perform`/bare-statement form has no `into` clause to receive rows a
 * `returning()` produces, and Postgres rejects a statement that returns
 * rows without one (#426). `"returning" in query` is `false` for a
 * `SelectNode` (a select is never refused here; a select never carries
 * `.returning()` to begin with), so this only ever fires for the three
 * mutation kinds.
 */
const assertExecuteHasNoReturning = (
	state: RecordingState,
	query: QueryNode,
): void => {
	if (!("returning" in query) || query.returning === null) {
		return;
	}
	throwHejbroError(
		"execute-expects-no-returning",
		`ctx.execute() in ${state.identity} received ${describeQueryKind(query)} that ends in .returning() — plpgsql's PERFORM/bare statement form has no INTO clause to receive the returned rows, and Postgres rejects a statement that returns rows without one. Next: drop the .returning() call to run this ${query.queryKind} for its effect, or pass it to ctx.return(...) instead of ctx.execute() when its rows are the function's result.`,
		state.declaredAt,
	);
};

/**
 * Refuses a mutation `QueryNode` that does NOT carry `.returning()` --
 * the mirror of {@link assertExecuteHasNoReturning}. `return query …`
 * needs a command that produces rows, and a mutation with no `RETURNING`
 * clause produces none, so Postgres rejects such a body at create time
 * (#686). `"returning" in query` is `false` for a `SelectNode` (a select
 * always produces rows, so it's never refused here), so this only ever
 * fires for the three mutation kinds -- reachable only by a caller that
 * bypasses `ReturnableQuery`'s own type-level exclusion of this shape
 * (task 2.1).
 */
const assertReturnHasReturning = (
	state: RecordingState,
	query: QueryNode,
): void => {
	if (!("returning" in query) || query.returning !== null) {
		return;
	}
	throwHejbroError(
		"return-expects-returning",
		`ctx.return() in ${state.identity} received ${describeQueryKind(query)} that never called .returning() — plpgsql's "return query" needs a command that produces rows, and this ${query.queryKind} produces none. Next: add .returning() to this ${query.queryKind} when its rows are the function's result, or run it with ctx.execute(...) instead of ctx.return() for its effect.`,
		state.declaredAt,
	);
};

/**
 * `ctx.execute(...)` (#426): records a select/insert/update/delete
 * builder as a statement run for its side effect. `returnableQueryNode`
 * returning `null` is reachable only by a caller that ignores `ReturnableQuery`
 * (raw JS, or a `ts-expect-error`/`as any` escape) — the same class of
 * gap `recordReturnShape` leaves its own `unsupported-return-value` to
 * name, so this states its own user-facing diagnostic here rather than
 * hiding behind the exempt `"unreachable"` code (#288 would flag that:
 * `unreachable` skips `check:next-marker`, and this site is reachable
 * once the type system is bypassed).
 */
const recordExecute = (state: RecordingState, value: ExecutableQuery): void => {
	const query = returnableQueryNode(value);
	if (query === null) {
		throwHejbroError(
			"execute-expects-statement",
			`ctx.execute() in ${state.identity} received a value that isn't a select, insert, update or delete builder. Next: pass a select, insert, update or delete builder to ctx.execute() instead.`,
			state.declaredAt,
		);
		return;
	}
	assertExecuteHasNoReturning(state, query);
	markConsumed(query);
	pushStatement(state, { stmtKind: "execute", query });
};

/** `true` for a plain expression — anything carrying a `family`/`exprNode` pair that isn't one of the four query shapes or a trigger row. */
const isReturnableExpr = (
	value: TriggerRow<Table> | ReturnableQuery | Expr,
): value is Expr => isExpr(value);

/** Names the shape the declaration's own `returns` actually wants, so the error says what to write instead of only what was wrong. */
const expectedReturnShape = (returnKind: ReturnKind): string => {
	if (returnKind === "trigger") {
		return "a trigger row (ctx.new/ctx.old)";
	}
	return "a query";
};

/** Records `return <expr>;`, which only a scalar-returning declaration can carry. */
const recordReturnExpr = (state: RecordingState, value: Expr): void => {
	if (state.returnKind !== "scalar") {
		throwHejbroError(
			"scalar-return-in-non-scalar-function",
			`ctx.return() in ${state.identity} received a scalar expression, but this declaration does not return a scalar type. Next: return ${expectedReturnShape(state.returnKind)} instead, or declare a scalar "returns" type.`,
			state.declaredAt,
		);
	}
	if (
		state.scalarReturnFamily !== null &&
		isRefusedReturnFamily(state.scalarReturnFamily, value.family)
	) {
		throwHejbroError(
			"scalar-return-family-mismatch",
			`ctx.return() in ${state.identity} received a ${value.family} expression, but this declaration returns a ${state.scalarReturnFamily} type. Postgres accepts the CREATE and every call then fails to convert the returned value. Next: return a ${state.scalarReturnFamily} expression, or declare a ${value.family} "returns" type.`,
			state.declaredAt,
		);
	}
	pushStatement(state, { stmtKind: "returnExpr", expr: value.exprNode });
};

/** Builds and throws the `scalar-return-expects-expression`-coded error (D57) -- shared by both non-expression shapes {@link recordReturn} can receive from a scalar-returning declaration (a trigger row and a query), so the message and code can't drift between the two call sites. #445/R4 review R-g: a `function` declaration, not an arrow `const`, because both call sites use it in *statement* position -- TS only narrows control flow through a `never` return that way; this file's other `never` helpers stay arrows because they are only ever called in return/expression position. */
function throwScalarReturnExpectsExpression(state: RecordingState): never {
	return throwHejbroError(
		"scalar-return-expects-expression",
		`ctx.return() in ${state.identity} received a query or trigger row, but this declaration returns a scalar type. Postgres rejects "return query" in a non-SETOF function at create time. Next: return an expression (a column ref, an argument ref, or a sql\`…\` fragment), or declare "returns" as a table for a setof function.`,
		state.declaredAt,
	);
}

/** `true` when `ref` (a mutation's `table`, or a select's `from` when it's a table and not a CTE) names the same table `declaredTable` does. */
const namesDeclaredTable = (
	ref: TableRefNode,
	declaredTable: NonNullable<SetofTableIdentity>,
): boolean =>
	ref.schemaName === declaredTable.schemaName &&
	ref.tableName === declaredTable.tableName;

/** `true` when a select's projection is `allColumns` and its `from` is the declared table (a `cteName` source is never a table) -- split out of {@link isWholeRowQuery} to keep each predicate's own branch count under the CRAP gate. */
const isWholeRowSelect = (
	query: SelectNode,
	declaredTable: NonNullable<SetofTableIdentity>,
): boolean =>
	query.projection.projectionKind === "allColumns" &&
	"schemaName" in query.from &&
	namesDeclaredTable(query.from, declaredTable);

/** `true` when a mutation's `returning` is `allColumns` and its own `table` is the declared table -- split out of {@link isWholeRowQuery}, mirroring {@link isWholeRowSelect}. */
const isWholeRowMutation = (
	query: Exclude<QueryNode, SelectNode>,
	declaredTable: NonNullable<SetofTableIdentity>,
): boolean => {
	// `ReturnableQuery`'s own shape excludes a set operation and a with
	// statement (neither ever reaches `ctx.return()`) -- this mirrors
	// `assertReturnHasReturning`'s own `"returning" in query` narrowing,
	// which the type checker needs here for the same reason.
	if (!("returning" in query)) {
		return false;
	}
	return (
		query.returning !== null &&
		query.returning.returningKind === "allColumns" &&
		namesDeclaredTable(query.table, declaredTable)
	);
};

/**
 * `true` when `query`'s own rows are exactly the declared table's whole
 * row (#749/D6/D7) — see {@link isWholeRowSelect}/{@link isWholeRowMutation}
 * for the two accepted shapes. Every other shape — a projection
 * (complete, reordered, or partial), an aliased column, or a query over a
 * different table — is not whole-row, even when nothing is technically
 * missing.
 */
const isWholeRowQuery = (
	query: QueryNode,
	declaredTable: NonNullable<SetofTableIdentity>,
): boolean => {
	if (query.queryKind === "select") {
		return isWholeRowSelect(query, declaredTable);
	}
	return isWholeRowMutation(query, declaredTable);
};

/**
 * Refuses a query whose rows are not the declared table's whole row, for
 * a `returns setof <table>` body (#749/D6) — `state.declaredTable` is
 * `null` for a trigger or scalar declaration, which never reaches this
 * check (both refuse a query shape of their own, earlier). Runs after
 * {@link assertReturnHasReturning} and before `markConsumed` (design.md):
 * a mutation with no `.returning()` at all still fails with
 * `return-expects-returning` first, and a refused query's builder is
 * never marked consumed, so `unusedBuilderMessage` still names it.
 */
const assertReturnIsWholeRow = (
	state: RecordingState,
	query: QueryNode,
): void => {
	const declaredTable = state.declaredTable;
	if (declaredTable === null || isWholeRowQuery(query, declaredTable)) {
		return;
	}
	const { schemaName, tableName } = declaredTable;
	throwHejbroError(
		"return-expects-whole-row",
		`ctx.return() in ${state.identity} received ${describeQueryKind(query)} whose rows are not the whole row of "${schemaName}"."${tableName}" — this declaration returns setof that table, and plpgsql's "return query" must produce exactly that row shape; Postgres accepts the CREATE and every call then fails with "structure of query does not match function result type". Next: return select(${tableName}), or an insert/update/delete on ${tableName} ending in a bare .returning(); to return a different shape, declare "returns" as that shape instead.`,
		state.declaredAt,
	);
};

/** {@link recordReturnShape}'s non-trigger-row half — split out to keep each function's own branching under the CRAP gate (#154 ratchet-5) now that the trigger-vs-query check (#426/1.10) adds one more branch. */
const recordReturnQueryShape = (
	state: RecordingState,
	value: ReturnableQuery,
): void => {
	if (state.returnKind === "scalar") {
		throwScalarReturnExpectsExpression(state);
	}
	const query = returnableQueryNode(value);
	if (query === null) {
		throwHejbroError(
			"unsupported-return-value",
			`ctx.return() in ${state.identity} received a value hejbro cannot return: pass a select over the declared table (under returns setof), a mutation with .returning(), or, in a trigger, new/old. Next: pass one of those.`,
			state.declaredAt,
		);
		return;
	}
	if (state.returnKind === "trigger") {
		throwHejbroError(
			"trigger-return-expects-row",
			`ctx.return() in ${state.identity} received a query, but a trigger body must return a trigger row (new/old). Postgres rejects "return query" inside a returns trigger function at create time. Next: run the statement with ctx.execute(...), then return the trigger row with ctx.return(new) (or old).`,
			state.declaredAt,
		);
		return;
	}
	assertReturnHasReturning(state, query);
	assertReturnIsWholeRow(state, query);
	markConsumed(query);
	pushStatement(state, { stmtKind: "returnQuery", query });
};

/** {@link recordReturn}'s non-expression dispatch: a trigger row or a query, exhaustively -- split out so each function's own branching stays under the CRAP gate (#154) once the brand check (#445/R4) is added. */
const recordReturnShape = (
	state: RecordingState,
	value: TriggerRow<Table> | ReturnableQuery,
): void => {
	if (isTriggerRow(value)) {
		if (state.returnKind === "scalar") {
			throwScalarReturnExpectsExpression(state);
		}
		pushStatement(state, {
			stmtKind: "returnRef",
			refName: value[triggerRowMeta],
		});
		return;
	}
	recordReturnQueryShape(state, value);
};

const recordReturn = (
	state: RecordingState,
	value: TriggerRow<Table> | ReturnableQuery | Expr,
): void => {
	state.returned.current = true;
	// #445/R4: the trigger-row brand (checked inside recordReturnShape) is
	// consulted before isReturnableExpr's duck-type (`"exprNode" in
	// value`) ever gets the deciding vote -- a table with a column
	// literally named `exprNode` gives its trigger row that same
	// property, which would otherwise misroute `ctx.return(ctx.new)` down
	// the expression path for that table only.
	if (!isTriggerRow(value) && isReturnableExpr(value)) {
		recordReturnExpr(state, value);
		return;
	}
	// the branch above already exhausted every Expr this function can
	// receive -- what's left is a TriggerRow or a ReturnableQuery.
	recordReturnShape(state, value as TriggerRow<Table> | ReturnableQuery);
};

const recordForEach = <TProjection extends RowProjection>(
	state: RecordingState,
	query: SelectLimited<TProjection>,
	body: (row: RowColumns<TProjection>) => void,
	name?: string,
): void => {
	markConsumed(query.selectQuery);
	state.loopCounter.current += 1;
	const loopName = name ?? `loop_${state.loopCounter.current}`;
	registerLoopName(state, loopName);
	state.declarations.push({ declKind: "record", name: loopName });

	const entries = resolveRowEntries(state, query.projectionInput);
	const rowProxy = Object.fromEntries(
		entries.map((entry) => [
			entry.key,
			expr(entry.columnRef.family, {
				nodeKind: "plpgsqlRef",
				path: [loopName, toSnakeCase(entry.key)],
			}),
		]),
	) as RowColumns<TProjection>;

	state.frames.push([]);
	body(rowProxy);
	const bodyStatements = popFrame(state);

	pushStatement(state, {
		stmtKind: "forEach",
		loopName,
		query: query.selectQuery,
		statements: bodyStatements,
	});
};

/**
 * One human-readable name per {@link QueryNode} kind — {@link
 * unusedBuilderMessage}'s own listing, never render-facing (that's
 * `renderExecutedStatement`'s job). A mapped type over the closed union
 * (same technique as `render-body.ts`'s own handler maps, #154
 * ratchet-5) rather than a `switch`'s `default: assertNever(...)`: the
 * union has exactly five kinds, so that default is structurally
 * unreachable and no test could ever cover it — a lookup object has no
 * such branch to leave uncovered.
 */
const queryKindNames: { readonly [K in QueryNode["queryKind"]]: string } = {
	select: "a select",
	insert: "an insert",
	update: "an update",
	delete: "a delete",
	setOp: "a set operation",
	// add-ctes / plpgsql-bodies rebase: `ReturnableQuery` (what
	// ctx.execute/ctx.return/ctx.row/ctx.rowOrNull/ctx.forEach accept)
	// does not include `WithStage`, so a body statement can never
	// legitimately consume a `withCte(...)` builder -- this entry exists
	// only to keep this lookup exhaustive over `QueryNode["queryKind"]`
	// now that it has a sixth member, not because this path is reachable
	// today.
	with: "a with statement",
};

const describeQueryKind = (query: QueryNode): string =>
	queryKindNames[query.queryKind];

/**
 * {@link unusedBuilderMessage}'s `Next:` clause — a select/insert/update/
 * delete has two working forms (`ctx.execute`, or a consumer that uses its
 * rows); a set operation has neither, since no body statement accepts one
 * yet (#423) — pointing at `ctx.execute` for it would send the user to a
 * call that rejects it (spec: "A failure names a form the body actually
 * accepts"). Both clauses can apply at once, since one declaration can
 * leave both kinds unconsumed.
 */
const unusedBuilderNextClause = (queries: ReadonlyArray<QueryNode>): string => {
	const clauses: Array<string> = [];
	if (queries.some((query) => query.queryKind !== "setOp")) {
		clauses.push(
			"run it for its effect with ctx.execute(...), or pass it to ctx.return(...)/ctx.row(...)/ctx.rowOrNull(...)/ctx.forEach(...) when its rows are the result",
		);
	}
	if (queries.some((query) => query.queryKind === "setOp")) {
		clauses.push(
			"a body has no statement that carries a set operation on its own — combine it into a select, insert, update or delete first",
		);
	}
	clauses.push(
		"or, if it was one of several built ahead of a choice, construct it only inside the branch you keep",
	);
	return clauses.join("; ");
};

/** `"statement"`/`"statements"` — the count is user-facing text (#423), not a template that reads fine either way. */
const pluralizeStatement = (count: number): string => {
	if (count === 1) {
		return "statement";
	}
	return "statements";
};

/** `"trigger"` when `returnKind` says so, `"function"` otherwise — the noun {@link unusedBuilderMessage} names the declaration by. */
const declarationNoun = (returnKind: ReturnKind): string => {
	if (returnKind === "trigger") {
		return "trigger";
	}
	return "function";
};

/**
 * `statement-builder-unused`'s message (#423): names every builder a body
 * made and never consumed, in the order it was made (`closeRecordingSession`'s
 * own order — a `Map`'s insertion order, deterministic for a given
 * recording so the determinism guard (D22) sees the same message from
 * both runs). Calls the declaration `"trigger"` rather than `"function"`
 * when `returnKind` says so — the user wrote `defineTrigger`, and
 * `returnKind` already distinguishes the two without asking the caller
 * for anything new.
 */
const unusedBuilderMessage = (
	identity: string,
	returnKind: ReturnKind,
	queries: ReadonlyArray<QueryNode>,
): string => {
	const kinds = queries.map(describeQueryKind).join(", ");
	const noun = declarationNoun(returnKind);
	return `${noun} "${identity}" built ${queries.length} ${pluralizeStatement(queries.length)} it never used (${kinds}). Next: ${unusedBuilderNextClause(queries)}.`;
};

/**
 * Builds the recording {@link BodyContext} for one `defineFunction`/
 * `defineTrigger` call: every `ctx.*` call appends to (or reads back) a
 * frame stack of {@link BodyStatement}s. `finish()` reads the finished tree
 * back out — call it exactly once, after the body callback has returned.
 *
 * The actual recording logic lives in the module-scope functions above
 * (`recordRow`, `recordIf`, `recordRaise`, `recordReturn`, `recordForEach`,
 * and their shared helpers), each taking the mutable {@link RecordingState}
 * as an explicit first parameter, rather than as ~15 closures nested
 * inside this function capturing its locals directly. That used to be a
 * CRAP-gate violation (#154 PR2): a CRAP/complexity tool attributes every
 * nested closure's own complexity to whichever named function lexically
 * contains it (the correct granularity for "which function would a human
 * actually refactor" — see `scripts/check-crap.mjs`'s own file comment),
 * so this function's reported complexity used to be the *sum* of all ~15
 * closures' complexity, even though each one is individually simple. Only
 * the capture mechanism changed here — module-scope functions taking an
 * explicit `state` parameter instead of closures reading it lexically —
 * not the recording behavior itself.
 */
export const createRecordingContext = (
	identity: string,
	declaredAt: string | null,
	returnKind: ReturnKind,
	scalarReturnFamily: SqlTypeFamily | null,
	declaredTable: SetofTableIdentity,
	argNames: ReadonlyArray<string>,
): { readonly ctx: BodyContext; readonly finish: () => FunctionBody } => {
	openRecordingSession();
	const state: RecordingState = {
		identity,
		declaredAt,
		returnKind,
		declaredTable,
		scalarReturnFamily,
		returned: { current: false },
		declarations: [],
		// Seeded before the body callback ever runs (#816): the arguments
		// already passed `resolveArgs`'s own SQL-name/reserved/duplicate
		// checks, so this only registers them -- checking an already-valid
		// name again would throw on the wrong occurrence.
		renderedNames: new Map(argNames.map((name) => [name, "argument"])),
		constructNames: new Map(),
		frames: [[]],
		rowCounter: { current: 0 },
		loopCounter: { current: 0 },
	};

	const ctx: BodyContext = {
		row: recordRow(state, true),
		rowOrNull: recordRow(state, false),
		if: (condition, thenBranch) => recordIf(state, condition, thenBranch),
		raise: (message, ...args) => recordRaise(state, message, args),
		return: (value) => recordReturn(state, value),
		execute: (statement) => recordExecute(state, statement),
		forEach: (query, body, name) => recordForEach(state, query, body, name),
	};

	const finish = (): FunctionBody => {
		// Closed first, unconditionally: the checks below still have to run,
		// but a thrown diagnostic must not leave this declaration's session
		// open for the next one to inherit (#426).
		const unconsumed = closeRecordingSession();
		// Checked before `scalar-return-missing`: a body that both leaves a
		// builder unused AND never returns has lost written code, which is
		// the more surprising failure — a missing return is visible just by
		// reading the same body, an unused builder is not (#423).
		if (unconsumed.length > 0) {
			throwHejbroError(
				"statement-builder-unused",
				unusedBuilderMessage(identity, returnKind, unconsumed),
				declaredAt,
			);
		}
		if (returnKind === "scalar" && !state.returned.current) {
			throwHejbroError(
				"scalar-return-missing",
				`function "${identity}" returns a scalar type but its body never calls ctx.return(). Postgres accepts the CREATE and then raises "control reached end of function without RETURN" on the first call. Next: return an expression from the body.`,
				declaredAt,
			);
		}
		return {
			declarations: [...state.declarations],
			statements: popFrame(state),
		};
	};

	return { ctx, finish };
};

/** The exact guard message (designer-approved copy) for a `nondeterministic-body` error. */
const nondeterministicBodyMessage = (identity: string): string =>
	`function "${identity}" produced two different recorded ASTs when its body ran twice at build time — the body must be pure and deterministic (no real if/for/while, Date.now(), Math.random(), or reads of mutable outer state). Next: replace real branching with ctx.if(), and non-deterministic values with the DSL's own now()/genRandomUuid() helpers.`;

/**
 * Runs one recording of `run` against a fresh context, guaranteeing the
 * recording session {@link createRecordingContext} opened is closed even
 * if `run` throws (#426) — a session a failed declaration leaves open
 * would make the *next* declaration inherit its builders, reporting (or
 * silently swallowing) an unrelated file's mistake. On success `finish()`
 * itself closes the session; `run` throwing means `finish()` never runs,
 * so the `catch` force-closes it here before re-throwing.
 */
const recordOnce = (
	identity: string,
	declaredAt: string | null,
	returnKind: ReturnKind,
	scalarReturnFamily: SqlTypeFamily | null,
	declaredTable: SetofTableIdentity,
	argNames: ReadonlyArray<string>,
	run: (ctx: BodyContext) => void,
): FunctionBody => {
	const { ctx, finish } = createRecordingContext(
		identity,
		declaredAt,
		returnKind,
		scalarReturnFamily,
		declaredTable,
		argNames,
	);
	try {
		run(ctx);
	} catch (error) {
		closeRecordingSession();
		throw error;
	}
	return finish();
};

/**
 * Runs `run` against two fresh recording contexts and compares the two
 * recorded {@link FunctionBody} trees structurally (`stableJson`) — the
 * determinism guard `defineFunction`/`defineTrigger` wrap their body
 * callback in (spec §6.2 decision A4). Throws `nondeterministic-body` on
 * mismatch; otherwise returns the (identical) recorded body.
 */
export const recordBodyWithGuard = (
	identity: string,
	declaredAt: string | null,
	returnKind: ReturnKind,
	scalarReturnFamily: SqlTypeFamily | null,
	declaredTable: SetofTableIdentity,
	argNames: ReadonlyArray<string>,
	run: (ctx: BodyContext) => void,
): FunctionBody => {
	const firstBody = recordOnce(
		identity,
		declaredAt,
		returnKind,
		scalarReturnFamily,
		declaredTable,
		argNames,
		run,
	);
	const secondBody = recordOnce(
		identity,
		declaredAt,
		returnKind,
		scalarReturnFamily,
		declaredTable,
		argNames,
		run,
	);

	if (stableJson(firstBody) !== stableJson(secondBody)) {
		throwHejbroError(
			"nondeterministic-body",
			nondeterministicBodyMessage(identity),
			declaredAt,
		);
	}

	return firstBody;
};
