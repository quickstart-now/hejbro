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

/** Hides a {@link TriggerRow}'s `new`/`old` identity behind a unique symbol (mirrors `dsl/table.ts`'s `tableMeta` pattern). */
export const triggerRowMeta: unique symbol = Symbol("hejbro:trigger-row-meta");

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
	readonly return: (value: TriggerRow<Table> | ReturnableQuery) => void;
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
 * Builds the recording {@link BodyContext} for one `defineFunction`/
 * `defineTrigger` call: every `ctx.*` call appends to (or reads back) a
 * frame stack of {@link BodyStatement}s. `finish()` reads the finished tree
 * back out — call it exactly once, after the body callback has returned.
 */
export const createRecordingContext = (
	identity: string,
	declaredAt: string | null,
): { readonly ctx: BodyContext; readonly finish: () => FunctionBody } => {
	const declarations: Array<PlpgsqlVarDeclaration> = [];
	const declaredNames = new Set<string>();
	const frames: Array<Array<BodyStatement>> = [[]];
	const rowCounter = { current: 0 };

	const currentFrame = (): Array<BodyStatement> => {
		const frame = frames.at(-1);
		if (frame === undefined) {
			return throwHejbroError(
				"unreachable",
				`${identity}: plpgsql body recording has an empty frame stack.`,
				declaredAt,
			);
		}
		return frame;
	};

	const popFrame = (): Array<BodyStatement> => {
		const frame = frames.pop();
		if (frame === undefined) {
			return throwHejbroError(
				"unreachable",
				`${identity}: plpgsql body recording popped an empty frame stack.`,
				declaredAt,
			);
		}
		return frame;
	};

	const pushStatement = (statement: BodyStatement): void => {
		currentFrame().push(statement);
	};

	const registerLocalName = (name: string): void => {
		assertValidLocalName(name, identity, declaredAt);
		if (declaredNames.has(name)) {
			throwHejbroError(
				"duplicate-local-name",
				`local name "${name}" is already declared in ${identity} — pick a different row name or variable.`,
				declaredAt,
			);
		}
		declaredNames.add(name);
	};

	const resolveRowEntries = (
		projectionInput: RowProjection,
	): ReadonlyArray<{ readonly key: string; readonly columnRef: ColumnRef }> =>
		Object.entries(asRecord(projectionInput)).map(([key, value]) => {
			if (!isColumnRefValue(value)) {
				return throwHejbroError(
					"row-projection-not-column",
					`ctx.row()/ctx.rowOrNull() projection key "${key}" in ${identity} isn't a plain column reference — pass table columns (e.g. table.column), not computed expressions.`,
					declaredAt,
				);
			}
			return { key, columnRef: value };
		});

	const recordRow =
		(strict: boolean) =>
		<TProjection extends RowProjection>(
			query: SelectLimited<TProjection>,
			name?: string,
		): RowColumns<TProjection> => {
			rowCounter.current += 1;
			const rowName = name ?? `row_${rowCounter.current}`;
			const entries = resolveRowEntries(query.projectionInput);

			const composed = entries.map((entry) => {
				const varName = `${rowName}_${toSnakeCase(entry.key)}`;
				registerLocalName(varName);
				declarations.push({
					name: varName,
					typeNode: entry.columnRef.typeNode,
				});
				return { key: entry.key, varName, family: entry.columnRef.family };
			});

			pushStatement({
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
		branches: Array<IfBranch>,
		statement: IfStatementDraft,
	): IfChain => ({
		elseIf: (condition, branch) => {
			frames.push([]);
			branch();
			const branchStatements = popFrame();
			branches.push({
				condition: condition.exprNode,
				statements: branchStatements,
			});
			return makeIfChain(branches, statement);
		},
		else: (branch) => {
			frames.push([]);
			branch();
			statement.elseStatements = popFrame();
		},
	});

	const recordIf = (
		condition: Expr<"boolean">,
		thenBranch: () => void,
	): IfChain => {
		frames.push([]);
		thenBranch();
		const thenStatements = popFrame();
		const branches: Array<IfBranch> = [
			{ condition: condition.exprNode, statements: thenStatements },
		];
		const statement: IfStatementDraft = {
			stmtKind: "if",
			branches,
			elseStatements: null,
		};
		pushStatement(statement);
		return makeIfChain(branches, statement);
	};

	const recordRaise = (
		message: string,
		...args: ReadonlyArray<RaiseArg>
	): void => {
		const placeholderCount = countPlaceholders(message);
		if (placeholderCount !== args.length) {
			throwHejbroError(
				"raise-arg-count-mismatch",
				`ctx.raise() message in ${identity} has ${placeholderCount} "%" placeholder(s) but received ${args.length} argument(s) — counts must match ("%%" renders as a literal percent sign).`,
				declaredAt,
			);
		}
		pushStatement({
			stmtKind: "raise",
			message,
			args: args.map((arg) => liftOperand(arg, "unknown")),
		});
	};

	const isTriggerRow = (value: unknown): value is TriggerRow<Table> =>
		typeof value === "object" && value !== null && triggerRowMeta in value;

	const recordReturn = (value: TriggerRow<Table> | ReturnableQuery): void => {
		if (isTriggerRow(value)) {
			pushStatement({ stmtKind: "returnRef", refName: value[triggerRowMeta] });
			return;
		}
		if ("selectQuery" in value) {
			pushStatement({ stmtKind: "returnQuery", query: value.selectQuery });
			return;
		}
		if ("insertQuery" in value) {
			pushStatement({ stmtKind: "returnQuery", query: value.insertQuery });
			return;
		}
		if ("updateQuery" in value) {
			pushStatement({ stmtKind: "returnQuery", query: value.updateQuery });
			return;
		}
		if ("deleteQuery" in value) {
			pushStatement({ stmtKind: "returnQuery", query: value.deleteQuery });
			return;
		}
		throwHejbroError(
			"unsupported-return-value",
			`ctx.return() in ${identity} received a value that isn't a trigger row (new/old) or a query with .returning() — pass one of those.`,
			declaredAt,
		);
	};

	const ctx: BodyContext = {
		row: recordRow(true),
		rowOrNull: recordRow(false),
		if: recordIf,
		raise: recordRaise,
		return: recordReturn,
	};

	const finish = (): FunctionBody => ({
		declarations: [...declarations],
		statements: popFrame(),
	});

	return { ctx, finish };
};

/** The exact guard message (designer-approved copy) for a `nondeterministic-body` error. */
const nondeterministicBodyMessage = (identity: string): string =>
	`function "${identity}" produced two different recorded ASTs when its body ran twice at build time — the body must be pure and deterministic (no real if/for/while, Date.now(), Math.random(), or reads of mutable outer state). Replace real branching with ctx.if(), and non-deterministic values with the DSL's own now()/genRandomUuid() helpers.`;

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
	run: (ctx: BodyContext) => void,
): FunctionBody => {
	const first = createRecordingContext(identity, declaredAt);
	run(first.ctx);
	const firstBody = first.finish();

	const second = createRecordingContext(identity, declaredAt);
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
