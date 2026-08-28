import type { ExprNode, QueryNode, SelectNode } from "../expr/ast";
import type { TypeNode } from "../types/type-node";

/**
 * One `declare` entry in a recorded plpgsql function body: a `ctx.row()`/
 * `ctx.rowOrNull()` scalar local (`<name> <typeNode>;`), or a `ctx.forEach()`
 * loop variable (`<name> record;` — a true plpgsql `record`, assigned fresh
 * on every iteration, unlike the scalar-per-column row locals).
 */
export type PlpgsqlVarDeclaration =
	| {
			readonly declKind: "scalar";
			readonly name: string;
			readonly typeNode: TypeNode;
	  }
	| { readonly declKind: "record"; readonly name: string };

/** One `if`/`elsif` branch: its condition plus the statements it guards. */
export type IfBranch = {
	readonly condition: ExprNode;
	readonly statements: ReadonlyArray<BodyStatement>;
};

/**
 * One recorded plpgsql statement. JSON-safe (`stableJson`-serializable) —
 * the whole tree this composes into (see {@link FunctionBody}) is compared
 * structurally by the Task 3 determinism guard.
 */
export type BodyStatement =
	| {
			readonly stmtKind: "selectInto";
			readonly query: SelectNode;
			readonly strict: boolean;
			readonly intoVariables: ReadonlyArray<string>;
	  }
	| {
			readonly stmtKind: "if";
			/** `[if, ...elsif]` in declaration order. */
			readonly branches: ReadonlyArray<IfBranch>;
			readonly elseStatements: ReadonlyArray<BodyStatement> | null;
	  }
	| {
			readonly stmtKind: "raise";
			readonly message: string;
			readonly args: ReadonlyArray<ExprNode>;
	  }
	| { readonly stmtKind: "returnRef"; readonly refName: string }
	| { readonly stmtKind: "returnQuery"; readonly query: QueryNode }
	/**
	 * `return <expr>;` — the scalar-returning function's only return shape
	 * (#424). Kept separate from `returnQuery` because plpgsql keeps them
	 * separate: `return query` is legal only in a SETOF function, and a
	 * scalar function reaching `end` without one of these raises at call
	 * time, so which of the two a body records is decided by the
	 * declaration's own `returns`, never by the value alone.
	 */
	| { readonly stmtKind: "returnExpr"; readonly expr: ExprNode }
	| {
			readonly stmtKind: "forEach";
			readonly loopName: string;
			readonly query: SelectNode;
			readonly statements: ReadonlyArray<BodyStatement>;
	  };

/** A recorded function/trigger body: its locals plus its statements, in order. */
export type FunctionBody = {
	readonly declarations: ReadonlyArray<PlpgsqlVarDeclaration>;
	readonly statements: ReadonlyArray<BodyStatement>;
};
