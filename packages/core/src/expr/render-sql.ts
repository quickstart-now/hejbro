import { assertNever, throwHejbroError } from "../error";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import type { ExprNode, SqlTemplateChunk, TableRefNode } from "./ast";
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

const nullTestKeyword = (negated: boolean): string => {
	if (negated) {
		return "is not null";
	}
	return "is null";
};

const inListKeyword = (negated: boolean): string => {
	if (negated) {
		return "not in";
	}
	return "in";
};

const betweenKeyword = (negated: boolean): string => {
	if (negated) {
		return "not between";
	}
	return "between";
};

const qualifiedFunctionName = (
	schemaName: string | null,
	functionName: string,
): string => {
	if (schemaName === null) {
		return functionName;
	}
	return `${schemaName}.${functionName}`;
};

const renderSqlTemplateChunk = (
	chunk: SqlTemplateChunk,
	outerScope: ReadonlyArray<TableRefNode> | undefined,
): string => {
	switch (chunk.chunkKind) {
		case "text":
			return chunk.text;
		case "expr":
			return renderExpr(chunk.expr, outerScope);
		default:
			return assertNever(chunk);
	}
};

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
			const suffix = nullTestKeyword(node.negated);
			return `${renderOperand(node.operand, outerScope)} ${suffix}`;
		}
		case "inList": {
			if (node.values.length === 0) {
				return throwHejbroError(
					"empty-in-list",
					"inArray() received an empty array — an empty in-list is always false in SQL; drop the condition or supply values.",
				);
			}
			const keyword = inListKeyword(node.negated);
			const values = node.values
				.map((value) => renderExpr(value, outerScope))
				.join(", ");
			return `${renderOperand(node.operand, outerScope)} ${keyword} (${values})`;
		}
		case "between": {
			const keyword = betweenKeyword(node.negated);
			return `${renderOperand(node.operand, outerScope)} ${keyword} ${renderOperand(node.lowerBound, outerScope)} and ${renderOperand(node.upperBound, outerScope)}`;
		}
		case "functionCall": {
			const name = qualifiedFunctionName(node.schemaName, node.functionName);
			const args = node.args
				.map((arg) => renderExpr(arg, outerScope))
				.join(", ");
			return `${name}(${args})`;
		}
		case "sqlTemplate":
			return node.chunks
				.map((chunk) => renderSqlTemplateChunk(chunk, outerScope))
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
