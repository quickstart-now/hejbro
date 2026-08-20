import type { Expr, ExprNode } from "../expr/ast";
import { assertSqlName } from "../sql/identifier-rules";

/** A declared CHECK constraint: its SQL name and the boolean expression tree (D50). */
export type CheckDeclaration = {
	readonly declarationKind: "check";
	readonly checkName: string;
	readonly expression: ExprNode;
};

/**
 * Declares a named CHECK constraint for a table's `extras.checks` — the
 * name is required and validated like every other SQL name (D36). Accepts
 * a boolean-typed `Expr` (from the typed helpers) or an `Expr<"unknown">`
 * (from the `sql` template, which cannot be narrowed to a family at compile
 * time) — the same `Expr<TFamily> | Expr<"unknown">` shape the operators
 * use for interpolated operands.
 */
export const check = (
	name: string,
	expression: Expr<"boolean"> | Expr<"unknown">,
): CheckDeclaration => ({
	declarationKind: "check",
	checkName: assertSqlName(name, "check", null),
	expression: expression.exprNode,
});
