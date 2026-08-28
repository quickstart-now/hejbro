import type { SelectNode } from "@hejbro/core";
import { and, eq, schema, select, sql, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("compile: joins", () => {
	it("left join renders left join … on with qualified columns", () => {
		const statement = select(posts).leftJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status" from "app"."posts" left join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
		expect(result.sql).not.toContain("*");
	});

	it("inner join renders inner join … on with qualified columns", () => {
		const statement = select(posts).innerJoin(
			comments,
			eq(comments.postId, posts.id),
		);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status" from "app"."posts" inner join "app"."comments" on "app"."comments"."post_id" = "app"."posts"."id"',
		);
		expect(result.sql).not.toContain("*");
	});

	it("an identifier containing a double quote is doubled, never terminates early", () => {
		// Bypasses the `table()` DSL (D36 forbids quotes in a declared name)
		// to exercise the compiler's own pipeline against a hand-built
		// `QueryNode`, proving `compile()` inherits core's `quoteIdentifier`
		// escaping rather than rendering any identifier itself.
		const node: SelectNode = {
			queryKind: "select",
			projection: { projectionKind: "allColumns", columnNames: ["id"] },
			from: { schemaName: "app", tableName: 'we"ird' },
			joins: [],
			where: null,
			orderBy: [],
			limit: null,
			offset: null,
			distinct: null,
		};

		const result = compile(node);

		expect(result.sql).toBe('select "id" from "app"."we""ird"');
	});

	it("a join-on literal is numbered after projection, before where", () => {
		const statement = select({ id: posts.id, tag: sql`${"proj"}` }, posts)
			.leftJoin(
				comments,
				and(eq(comments.postId, posts.id), eq(posts.status, "joined")),
			)
			.where(eq(posts.status, "final"));

		const result = compile(statement);

		// The params array alone can't catch a broken startIndex carry (its
		// order is just concat order, independent of the numbers actually
		// rendered) — asserting the SQL text is what pins $1/$2/$3 to their
		// positions.
		expect(result.sql).toBe(
			'select "app"."posts"."id" as "id", $1 as "tag" from "app"."posts" left join "app"."comments" on ("app"."comments"."post_id" = "app"."posts"."id") and ("app"."posts"."status" = $2) where "app"."posts"."status" = $3',
		);
		expect(result.params).toEqual(["proj", "joined", "final"]);
	});
});
