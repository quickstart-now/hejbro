import type { Table } from "../dsl/table";
import { toSnakeCase } from "../dsl/table";
import { throwHejbroError } from "../error";
import type { ColumnRef, Expr } from "../expr/ast";
import { expr, isExpr } from "../expr/ast";
import { liftOperand } from "../expr/literal";
import type { DeleteFinal, InsertFinal, UpdateFinal } from "../query/mutate";
import type { SelectLimited } from "../query/select";
import { stableJson } from "../snapshot/stable-json";
import type { BuilderFamily } from "../types/column-builder";
import type {
	BodyStatement,
	FunctionBody,
	IfBranch,
	PlpgsqlVarDeclaration,
} from "./body-ast";
import { assertValidLocalName } from "./reserved";

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
	readonly elseIf: (condition: Expr<"boolean">, branch: () => void) => IfChain;
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

/** What `ctx.return()` accepts besides a trigger row: any query ending in `.returning()`/a bare select. */
export type ReturnableQuery =
	| SelectLimited
	| InsertFinal
	| UpdateFinal
	| DeleteFinal;

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
	readonly if: (condition: Expr<"boolean">, thenBranch: () => void) => IfChain;
	readonly raise: (message: string, ...args: ReadonlyArray<RaiseArg>) => void;
	readonly return: (value: TriggerRow<Table> | ReturnableQuery | Expr) => void;
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

type RecordingState = {
	readonly identity: string;
	readonly declaredAt: string | null;
	readonly returnKind: ReturnKind;
	/** set the moment any return statement is recorded, at any nesting depth — a scalar function that never sets it has no way to produce its value. */
	readonly returned: { current: boolean };
	readonly declarations: Array<PlpgsqlVarDeclaration>;
	readonly declaredNames: Set<string>;
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

const registerLocalName = (state: RecordingState, name: string): void => {
	assertValidLocalName(name, state.identity, state.declaredAt);
	if (state.declaredNames.has(name)) {
		throwHejbroError(
			"duplicate-local-name",
			`local name "${name}" is already declared in ${state.identity}. Next: pick a different row name or variable.`,
			state.declaredAt,
		);
	}
	state.declaredNames.add(name);
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
		state.rowCounter.current += 1;
		const rowName = name ?? `row_${state.rowCounter.current}`;
		const entries = resolveRowEntries(state, query.projectionInput);

		const composed = entries.map((entry) => {
			const varName = `${rowName}_${toSnakeCase(entry.key)}`;
			registerLocalName(state, varName);
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
	condition: Expr<"boolean">,
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
 * {@link recordReturn}'s `ReturnableQuery` half — split out to keep both
 * halves' own complexity under threshold (D71/#154 ratchet-5). Returns
 * `true` once it has pushed a `returnQuery` statement, `false` if `value`
 * matched none of the four query shapes — structurally unreachable for a
 * type-correct caller (`ReturnableQuery`'s own four members each carry
 * exactly one of these keys), the same class of gap a `switch`'s
 * `default: assertNever(...)` leaves elsewhere in this codebase, kept
 * here as a real runtime `false` (not a throw) so {@link recordReturn}
 * — not this function — decides what "no query shape matched" means for
 * its own caller.
 */
const recordReturnQuery = (
	state: RecordingState,
	value: ReturnableQuery,
): boolean => {
	if ("selectQuery" in value) {
		pushStatement(state, { stmtKind: "returnQuery", query: value.selectQuery });
		return true;
	}
	if ("insertQuery" in value) {
		pushStatement(state, { stmtKind: "returnQuery", query: value.insertQuery });
		return true;
	}
	if ("updateQuery" in value) {
		pushStatement(state, { stmtKind: "returnQuery", query: value.updateQuery });
		return true;
	}
	if ("deleteQuery" in value) {
		pushStatement(state, { stmtKind: "returnQuery", query: value.deleteQuery });
		return true;
	}
	return false;
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
	pushStatement(state, { stmtKind: "returnExpr", expr: value.exprNode });
};

const recordReturn = (
	state: RecordingState,
	value: TriggerRow<Table> | ReturnableQuery | Expr,
): void => {
	state.returned.current = true;
	if (isReturnableExpr(value)) {
		recordReturnExpr(state, value);
		return;
	}
	if (state.returnKind === "scalar") {
		throwHejbroError(
			"scalar-return-expects-expression",
			`ctx.return() in ${state.identity} received a query or trigger row, but this declaration returns a scalar type. Postgres rejects "return query" in a non-SETOF function at create time. Next: return an expression (a column ref, an argument ref, or a sql\`…\` fragment), or declare "returns" as a table for a setof function.`,
			state.declaredAt,
		);
	}
	if (isTriggerRow(value)) {
		pushStatement(state, {
			stmtKind: "returnRef",
			refName: value[triggerRowMeta],
		});
		return;
	}
	if (recordReturnQuery(state, value)) {
		return;
	}
	throwHejbroError(
		"unsupported-return-value",
		`ctx.return() in ${state.identity} received a value that isn't a trigger row (new/old) or a query with .returning(). Next: pass one of those.`,
		state.declaredAt,
	);
};

const recordForEach = <TProjection extends RowProjection>(
	state: RecordingState,
	query: SelectLimited<TProjection>,
	body: (row: RowColumns<TProjection>) => void,
	name?: string,
): void => {
	state.loopCounter.current += 1;
	const loopName = name ?? `loop_${state.loopCounter.current}`;
	registerLocalName(state, loopName);
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
): { readonly ctx: BodyContext; readonly finish: () => FunctionBody } => {
	const state: RecordingState = {
		identity,
		declaredAt,
		returnKind,
		returned: { current: false },
		declarations: [],
		declaredNames: new Set(),
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
		forEach: (query, body, name) => recordForEach(state, query, body, name),
	};

	const finish = (): FunctionBody => {
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
	run: (ctx: BodyContext) => void,
): FunctionBody => {
	const first = createRecordingContext(identity, declaredAt, returnKind);
	run(first.ctx);
	const firstBody = first.finish();

	const second = createRecordingContext(identity, declaredAt, returnKind);
	run(second.ctx);
	const secondBody = second.finish();

	if (stableJson(firstBody) !== stableJson(secondBody)) {
		throwHejbroError(
			"nondeterministic-body",
			nondeterministicBodyMessage(identity),
			declaredAt,
		);
	}

	return firstBody;
};
