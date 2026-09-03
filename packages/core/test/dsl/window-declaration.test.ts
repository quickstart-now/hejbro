import { describe, expect, it } from "vitest";
import { check } from "../../src/dsl/check";
import { index } from "../../src/dsl/index-builder";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import type { Expr } from "../../src/expr/ast";
import { expr } from "../../src/expr/ast";
import { isNotNull } from "../../src/expr/operators";
import { over, rank } from "../../src/expr/window";
import { uuid } from "../../src/types/column-builder-factories";

const app = schema("app");

/**
 * A hand-built window `Expr<"unknown">` (the `sql` escape hatch's own
 * shape) — `over()`/`rank()` already exist (group 2), but every
 * declaration site here (`check`/index expression/index predicate)
 * accepts `Expr<"unknown">` the same way `sql\`\`` does, and wrapping this
 * way keeps the test independent of any one column's declared family.
 */
const windowedCondition = (column: Expr): Expr<"unknown"> =>
	expr("unknown", over(rank(), { partitionBy: [column] }).exprNode);

describe("declaration sites with an existing subquery guard also refuse a window function (task 3.3)", () => {
	it("a check constraint refuses a window function, naming the constraint", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), authorId: uuid() }, (t) => ({
				checks: [check("posts_bad", windowedCondition(t.authorId))],
			})),
		).toThrowError(expect.objectContaining({ code: "check-window-function" }));
	});

	it("an index expression refuses a window function, naming the index", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), authorId: uuid() }, (t) => ({
				indexes: [index("posts_bad_idx").on(windowedCondition(t.authorId))],
			})),
		).toThrowError(
			expect.objectContaining({ code: "index-expression-window-function" }),
		);
	});

	it("an index predicate refuses a window function, naming the index", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), authorId: uuid() }, (t) => ({
				indexes: [
					index("posts_bad_idx").on(t.id).where(windowedCondition(t.authorId)),
				],
			})),
		).toThrowError(
			expect.objectContaining({ code: "index-predicate-window-function" }),
		);
	});

	it("the three codes are distinct from each other and from 3.1/3.2's", () => {
		const codes = new Set<string>();
		try {
			table(app, "a", { id: uuid(), authorId: uuid() }, (t) => ({
				checks: [check("a_bad", windowedCondition(t.authorId))],
			}));
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		try {
			table(app, "b", { id: uuid(), authorId: uuid() }, (t) => ({
				indexes: [index("b_bad_idx").on(windowedCondition(t.authorId))],
			}));
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		try {
			table(app, "c", { id: uuid(), authorId: uuid() }, (t) => ({
				indexes: [
					index("c_bad_idx").on(t.id).where(windowedCondition(t.authorId)),
				],
			}));
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		expect(codes).toEqual(
			new Set([
				"check-window-function",
				"index-expression-window-function",
				"index-predicate-window-function",
			]),
		);
	});

	it("does not reject a legitimate isNotNull predicate (control)", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), publishedAt: uuid() }, (t) => ({
				indexes: [
					index("posts_ok_idx").on(t.id).where(isNotNull(t.publishedAt)),
				],
			})),
		).not.toThrow();
	});
});

describe("declaration sites with no precedent guard refuse a window function too (task 3.4)", () => {
	// A column default/generated expression is declared on the column
	// BUILDER itself, before the table's own `t.*` refs exist -- an
	// already-declared sibling table's column stands in for "some real
	// column" here, which is all the guard's own shape check needs.
	const other = table(app, "other", { id: uuid() });

	it("a column default refuses a window function, naming the column", () => {
		expect(() =>
			table(app, "posts", {
				id: uuid(),
				ownerId: uuid().default(windowedCondition(other.id)),
			}),
		).toThrowError(
			expect.objectContaining({ code: "column-default-window-function" }),
		);
	});

	it("a generated column refuses a window function, naming the column", () => {
		expect(() =>
			table(app, "posts", {
				id: uuid(),
				computed: uuid().generatedAlwaysAs(windowedCondition(other.id)),
			}),
		).toThrowError(
			expect.objectContaining({ code: "generated-column-window-function" }),
		);
	});

	it("a policy's using refuses a window function, naming the policy", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), authorId: uuid() }, (t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_own")
						.for("select")
						.to("authenticated")
						.using(windowedCondition(t.authorId)),
				}),
			})),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-window-function" }),
		);
	});

	it("a policy's with check refuses a window function too", () => {
		expect(() =>
			table(app, "posts", { id: uuid(), authorId: uuid() }, (t) => ({
				rls: rls.enabled({
					write: rls
						.policy("posts_write_own")
						.for("insert")
						.to("authenticated")
						.withCheck(windowedCondition(t.authorId)),
				}),
			})),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-window-function" }),
		);
	});

	it("the three new codes are each their own site, one red test per site (not one shared test)", () => {
		const codes = new Set<string>();
		try {
			table(app, "d", {
				id: uuid(),
				ownerId: uuid().default(windowedCondition(other.id)),
			});
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		try {
			table(app, "e", {
				id: uuid(),
				computed: uuid().generatedAlwaysAs(windowedCondition(other.id)),
			});
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		try {
			table(app, "f", { id: uuid(), authorId: uuid() }, (t) => ({
				rls: rls.enabled({
					read: rls
						.policy("f_read")
						.for("select")
						.to("authenticated")
						.using(windowedCondition(t.authorId)),
				}),
			}));
		} catch (error) {
			codes.add((error as { code?: string }).code as string);
		}
		expect(codes).toEqual(
			new Set([
				"column-default-window-function",
				"generated-column-window-function",
				"rls-policy-window-function",
			]),
		);
	});
});
