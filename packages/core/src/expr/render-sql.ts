import { assertNever, throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type { ExprNode, TableRefNode } from "./ast";
import { renderLiteral } from "./literal";

/** Composite node kinds that must be parenthesized when used as an operand. */
const compositeNodeKinds = new Set([
	"comparison",
	"logical",
	"not",
	"nullTest",
	"inList",
	"between",
]);

const renderOperand = (
	node: ExprNode,
	outerScope: ReadonlyArray<TableRefNode> | undefined,
): string => {
	const rendered = renderExpr(node, outerScope);
	if (compositeNodeKinds.has(node.nodeKind)) {
		return `(${rendered})`;
	}
	return rendered;
};

/**
 * Renders an {@link ExprNode} as deterministic SQL text. `outerScope` names
 * the tables an `exists` subquery may correlate against beyond its own
 * `from` — accepted here but not yet consumed (Task 8 wires it up).
 */
export const renderExpr = (
	node: ExprNode,
	outerScope?: ReadonlyArray<TableRefNode>,
): string => {
	switch (node.nodeKind) {
		case "literal":
			return renderLiteral(node);
		case "columnRef":
			return `${qualifyName(node.schemaName, node.tableName)}.${quoteIdentifier(node.columnName)}`;
		case "comparison":
			return `${renderOperand(node.left, outerScope)} ${node.operator} ${renderOperand(node.right, outerScope)}`;
		case "logical": {
			if (node.operands.length === 0) {
				return throwHejbroError(
					"empty-logical-expression",
					"and()/or() need at least one operand — pass at least one boolean expression.",
				);
			}
			return node.operands
				.map((operand) => renderOperand(operand, outerScope))
				.join(` ${node.operator} `);
		}
		case "not":
			return `not ${renderOperand(node.operand, outerScope)}`;
		case "nullTest": {
			const suffix = node.negated ? "is not null" : "is null";
			return `${renderOperand(node.operand, outerScope)} ${suffix}`;
		}
		case "inList": {
			if (node.values.length === 0) {
				return throwHejbroError(
					"empty-in-list",
					"inArray() received an empty array — an empty in-list is always false in SQL; drop the condition or supply values.",
				);
			}
			const keyword = node.negated ? "not in" : "in";
			const values = node.values
				.map((value) => renderExpr(value, outerScope))
				.join(", ");
			return `${renderOperand(node.operand, outerScope)} ${keyword} (${values})`;
		}
		case "between": {
			const keyword = node.negated ? "not between" : "between";
			return `${renderOperand(node.operand, outerScope)} ${keyword} ${renderOperand(node.lowerBound, outerScope)} and ${renderOperand(node.upperBound, outerScope)}`;
		}
		case "functionCall": {
			const name =
				node.schemaName === null
					? node.functionName
					: `${node.schemaName}.${node.functionName}`;
			const args = node.args
				.map((arg) => renderExpr(arg, outerScope))
				.join(", ");
			return `${name}(${args})`;
		}
		case "sqlTemplate":
			return node.chunks
				.map((chunk) => {
					if (chunk.chunkKind === "text") {
						return chunk.text;
					}
					return renderExpr(chunk.expr, outerScope);
				})
				.join("");
		case "rawSql":
			return node.sql;
		case "exists":
			return throwHejbroError(
				"not-implemented-yet",
				"exists rendering lands with the select builder (Task 8).",
			);
		default:
			return assertNever(node);
	}
};
