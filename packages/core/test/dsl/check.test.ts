import { describe, expect, it } from "vitest";
import { check } from "../../src/dsl/check";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { generateMigration } from "../../src/engine/generate";
import {
	and,
	between,
	coalesce,
	eq,
	gt,
	inArray,
	not,
} from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import { exists, select } from "../../src/query/select";
import { emptySnapshot } from "../../src/snapshot/snapshot";
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

	// #110 items 27/28/30: coverage measured by main (a separate detached
	// worktree, not this one -- no coverage tooling is added here, D65
	// scope decision pending) found someExprNode's recursive branches
	// (logical/between/functionCall, expr/walk.ts) and collectColumnRefs's
	// `not` branch (expr/render-sql.ts:122) were never exercised by any
	// existing test -- every prior subquery/foreign-column-ref test put
	// exists()/the bad ref at the TOP of the expression, never nested
	// inside a wrapper. Both validateChecks (dsl/table.ts) helpers use
	// these exact recursive functions, so an untested branch there is an
	// untested validation path, not just an untested utility function.
	// Each case below is proven load-bearing by direct mutation (see the
	// PR body for the before/after): temporarily breaking the
	// corresponding branch in expr/walk.ts / expr/render-sql.ts made
	// exactly that test fail, nothing else.
	it("rejects a subquery nested inside a logical (and/or) operand", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				checks: [
					check(
						"bad",
						and(
							eq(t.id, t.id),
							exists(select(other).where(eq(other.id, t.id))),
						),
					),
				],
			})),
		).toThrow(
			/check-subquery|Postgres forbids subqueries in CHECK constraints/,
		);
	});

	it("rejects a subquery nested inside a between operand", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				checks: [
					check(
						"bad",
						between(
							exists(select(other).where(eq(other.id, t.id))),
							eq(t.id, t.id),
							eq(t.id, t.id),
						),
					),
				],
			})),
		).toThrow(
			/check-subquery|Postgres forbids subqueries in CHECK constraints/,
		);
	});

	it("rejects a subquery nested inside a function-call argument", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				checks: [
					check(
						"bad",
						coalesce(
							exists(select(other).where(eq(other.id, t.id))),
							eq(t.id, t.id),
						),
					),
				],
			})),
		).toThrow(
			/check-subquery|Postgres forbids subqueries in CHECK constraints/,
		);
	});

	it("rejects a foreign column reference nested inside not(...)", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "posts", { id: uuid() }, () => ({
				checks: [check("bad", not(eq(other.n, "x")))],
			})),
		).toThrow(
			/check-foreign-column-ref|a CHECK can only see the row being written/,
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

// TERMINAL contract (add-array-ergonomics task 1.3): the derived expression
// is a structured node (columnRef + functionCall + null literal, wrapped in
// the same nullTest `isNull()` itself builds) -- never a rawSql/sqlTemplate
// fragment, so a column rename keeps tracking it the same way it tracks
// every hand-written check. The renderer always fully qualifies a
// columnRef (render-sql.ts's renderColumnRefNode), so the emitted SQL text
// is schema.table.column-qualified -- pinned once here, for this file's
// own `app`/`posts`/`tags` fixture, and reused by every assertion below.
const tagsNoNullElementsSql =
	'array_position("app"."posts"."tags", null) is null';

describe(".notNullElements() derives its own backing check (add-array-ergonomics, task 1.3)", () => {
	it("emits a CHECK named <column>_no_null_elements with the owner-settled expression", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			tags: text().array().notNullElements(),
		});
		expect(getTableMeta(posts).checks).toEqual([
			{
				declarationKind: "check",
				checkName: "tags_no_null_elements",
				expression: {
					nodeKind: "nullTest",
					negated: false,
					operand: {
						nodeKind: "functionCall",
						schemaName: null,
						functionName: "array_position",
						args: [
							{
								nodeKind: "columnRef",
								schemaName: "app",
								tableName: "posts",
								columnName: "tags",
							},
							{ nodeKind: "literal", literal: { literalKind: "null" } },
						],
					},
				},
			},
		]);

		const migration = generateMigration({
			declarations: [app, getTableMeta(posts)],
			previousSnapshot: emptySnapshot,
		});
		expect(migration.sql).toContain(
			`constraint "tags_no_null_elements" check (${tagsNoNullElementsSql})`,
		);
	});

	it("collides loudly with a hand-declared check of the same name", () => {
		expect(() =>
			table(
				app,
				"posts",
				{ id: uuid().primaryKey(), tags: text().array().notNullElements() },
				() => ({
					checks: [check("tags_no_null_elements", sql`true`)],
				}),
			),
		).toThrow(
			/duplicate-check-name|requires unique constraint names per table/,
		);
	});

	it("removing the declaration drops the check, exactly like a hand-declared one", () => {
		const before = table(app, "posts", {
			id: uuid().primaryKey(),
			tags: text().array().notNullElements(),
		});
		const after = table(app, "posts", {
			id: uuid().primaryKey(),
			tags: text().array(),
		});
		const migration = generateMigration({
			declarations: [app, after],
			previousSnapshot: generateMigration({
				declarations: [app, before],
				previousSnapshot: emptySnapshot,
			}).snapshot,
		});
		expect(migration.sql).toContain(
			'alter table "app"."posts" drop constraint "tags_no_null_elements";',
		);
	});
});
