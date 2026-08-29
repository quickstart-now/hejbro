import { describe, expect, it } from "vitest";
import type { Expr, ExprNode } from "../../src/index";
import {
	boolean,
	expr,
	lag,
	max,
	over,
	rank,
	rowNumber,
	schema,
	select,
	sum,
	table,
	text,
	timestamptz,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	authorId: uuid().notNull(),
	publishedAt: timestamptz(),
	active: boolean().notNull(),
});

// A boolean-family windowed value (lag() passes the operand's own family
// through), so it type-checks as a Condition -- a numeric window function
// like rank() never would, independent of the placement rule this task
// adds (where()/having() already reject a plain numeric Expr).
const windowed = () =>
	over(lag(posts.active), { partitionBy: [posts.authorId] });

describe("window function placement (task 3.1)", () => {
	it("where refuses a window function", () => {
		expect(() => select(posts).where(windowed())).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
	});

	it("group by refuses a window function", () => {
		expect(() => select(posts).groupBy(windowed())).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
	});

	it("having refuses a window function", () => {
		expect(() =>
			select(posts).groupBy(posts.authorId).having(windowed()),
		).toThrowError(
			expect.objectContaining({ code: "window-function-not-allowed" }),
		);
	});

	it("the diagnostic names the clause and gives a remedy", () => {
		try {
			select(posts).where(windowed());
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).toContain("where");
			expect((error as Error).message).toContain("Next:");
		}
	});

	it("distinct on accepts a window function (query-builder spec: distinct on accepts a window function)", () => {
		expect(() => select(posts).distinctOn(rowNumber() as never)).not.toThrow();
	});

	it("a window function inside a subquery's own select list stays legal (the shallow walker's own rule)", () => {
		// Same "exists() is opaque to the shallow walker" precedent
		// check-subquery already relies on -- a where() containing an
		// exists() whose OWN select list has a window function must not be
		// rejected: the embedded query's own projection is a different
		// query, evaluated on its own terms. Hand-built (there is no
		// public DSL path for an exists() with a window projection yet)
		// via the same expr()-wrapping technique used throughout this
		// change's other hand-built-node tests.
		const existsWithWindowProjection: ExprNode = {
			nodeKind: "exists",
			negated: false,
			query: {
				queryKind: "select",
				projection: {
					projectionKind: "columns",
					columns: [{ alias: "rnk", expr: windowed().exprNode }],
				},
				from: { schemaName: "app", tableName: "posts" },
				joins: [],
				where: null,
				groupBy: [],
				having: null,
				orderBy: [],
				limit: null,
				offset: null,
				distinct: null,
			},
		};
		const condition: Expr<"unknown"> = expr(
			"unknown",
			existsWithWindowProjection,
		);
		expect(() => select(posts).where(condition)).not.toThrow();
	});
});

describe("aggregate refuses a windowed argument (task 3.2)", () => {
	it("sum() refuses an argument that is itself a windowed expression", () => {
		// over(rank(), ...) returns a real Expr (it already survived the
		// build-time OVER requirement), so the type system alone can't
		// catch this the way it catches a bare rank() -- Postgres's own
		// separate rule (42803) needs its own runtime check.
		expect(() =>
			sum(over(rank(), { partitionBy: [posts.authorId] })),
		).toThrowError(
			expect.objectContaining({ code: "windowed-aggregate-argument" }),
		);
	});

	it("max() refuses a windowed argument too, with a message distinct from the placement rule's", () => {
		try {
			max(over(lag(posts.publishedAt), {}));
			expect.unreachable();
		} catch (error) {
			expect((error as { code?: string }).code).toBe(
				"windowed-aggregate-argument",
			);
			expect((error as Error).message).toContain("Next:");
			expect((error as { code?: string }).code).not.toBe(
				"window-function-not-allowed",
			);
		}
	});

	it("an aggregate over a plain column is unaffected", () => {
		expect(() => sum(posts.authorId)).not.toThrow();
	});
});
