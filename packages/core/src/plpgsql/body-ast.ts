import type { ExprNode, QueryNode, SelectNode } from "../expr/ast";
import type { TypeNode } from "../types/type-node";

/** One `declare` entry in a recorded plpgsql function body. */
export type PlpgsqlVarDeclaration = {
	readonly name: string;
	readonly typeNode: TypeNode;
};

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
	| { readonly stmtKind: "returnQuery"; readonly query: QueryNode };

/** A recorded function/trigger body: its locals plus its statements, in order. */
export type FunctionBody = {
	readonly declarations: ReadonlyArray<PlpgsqlVarDeclaration>;
	readonly statements: ReadonlyArray<BodyStatement>;
};
