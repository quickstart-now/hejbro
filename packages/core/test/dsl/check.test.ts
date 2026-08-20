import { describe, expect, it } from "vitest";
import { check } from "../../src/dsl/check";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, gt, inArray } from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import { exists, select } from "../../src/query/select";
import { text, uuid } from "../../src/types/column-builder-factories";

const app = schema("app");

describe("check()", () => {
	it("declares a named check on the table", () => {
		const posts = table(
			app,
			"posts",
			{ id: uuid().primaryKey(), status: text().notNull() },
			(t) => ({
				checks: [
					check(
						"posts_status_check",
						inArray(t.status, ["draft", "published"]),
					),
				],
			}),
		);
		expect(getTableMeta(posts).checks.map((c) => c.checkName)).toEqual([
			"posts_status_check",
		]);
	});

	it("accepts sql-template expressions with column interpolation", () => {
		const posts = table(app, "posts", { body: text() }, (t) => ({
			checks: [
				check("posts_body_not_blank", sql`length(btrim(${t.body})) > 0`),
			],
		}));
		expect(getTableMeta(posts).checks).toHaveLength(1);
	});

	it("rejects a column of another table", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "posts", { id: uuid() }, () => ({
				checks: [check("bad", eq(other.n, "x"))],
			})),
		).toThrow(
			/check-foreign-column-ref|a CHECK can only see the row being written/,
		);
	});

	it("rejects subqueries", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				checks: [check("bad", exists(select(other).where(eq(other.id, t.id))))],
			})),
		).toThrow(
			/check-subquery|Postgres forbids subqueries in CHECK constraints/,
		);
	});

	it("rejects an invalid name and duplicate names", () => {
		expect(() => check("Bad Name", gt(sql`1`, sql`0`))).toThrow(
			/invalid-sql-name|not a valid hejbro SQL identifier/,
		);
		expect(() =>
			table(app, "posts", { n: text() }, (t) => ({
				checks: [check("dup", gt(t.n, "a")), check("dup", gt(t.n, "b"))],
			})),
		).toThrow(
			/duplicate-check-name|requires unique constraint names per table/,
		);
	});
});
