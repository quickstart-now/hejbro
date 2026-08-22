import type { Expr, SqlTemplateChunk } from "./ast";
import { expr, isExpr } from "./ast";
import { liftLiteral } from "./literal";

/** A value that may be interpolated into a `` sql`…` `` template: an existing typed expression, or a raw JS scalar that auto-lifts to a quoted literal. */
export type SqlInterpolation = Expr | string | number | boolean | Date | null;

type SqlTag = {
	(
		strings: TemplateStringsArray,
		...values: ReadonlyArray<SqlInterpolation>
	): Expr<"unknown">;
	raw(rawSql: string): Expr<"unknown">;
};

const chunkForInterpolation = (value: SqlInterpolation): SqlTemplateChunk => {
	if (isExpr(value)) {
		return { chunkKind: "expr", expr: value.exprNode };
	}
	return { chunkKind: "expr", expr: liftLiteral(value, "unknown") };
};

const sqlTag = (
	strings: TemplateStringsArray,
	...values: ReadonlyArray<SqlInterpolation>
): Expr<"unknown"> => {
	const textChunks: ReadonlyArray<SqlTemplateChunk> = strings.map((text) => ({
		chunkKind: "text",
		text,
	}));
	const valueChunks: ReadonlyArray<SqlTemplateChunk> = values.map(
		chunkForInterpolation,
	);
	const chunks = textChunks.flatMap((textChunk, index) => {
		const valueChunk = valueChunks[index];
		if (valueChunk === undefined) {
			return [textChunk];
		}
		return [textChunk, valueChunk];
	});
	return expr("unknown", { nodeKind: "sqlTemplate", chunks });
};

/**
 * A tagged template for building `Expr<"unknown">` SQL fragments — plain
 * values are always quoted as literals (D18); use `sql.raw` for the rare
 * verbatim escape hatch.
 */
export const sql: SqlTag = Object.assign(sqlTag, {
	raw: (rawSql: string): Expr<"unknown"> =>
		expr("unknown", { nodeKind: "rawSql", sql: rawSql }),
});
