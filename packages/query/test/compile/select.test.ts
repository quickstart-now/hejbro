import {
	eq,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("compile: select with where", () => {
	it("select with where compiles to parameterized SQL, no star", () => {
		const statement = select(posts).where(eq(posts.status, "published"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.sql).not.toContain("*");
		// "published" itself legitimately appears in the "published_at"
		// column name — the value must never appear quoted as a literal.
		expect(result.sql).not.toContain("'published'");
		expect(result.params).toEqual(["published"]);
		expect(result.kind).toBe("select");
	});

	it("an adversarial where value never appears in the SQL text, only in params", () => {
		const payload = "'; drop table users; --";
		const statement = select(posts).where(eq(posts.status, payload));
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.params).toEqual([payload]);
	});

	it("a value that looks like a placeholder stays a value, not a parameter number", () => {
		const statement = select(posts).where(eq(posts.status, "$1"));
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts" where "app"."posts"."status" = $1',
		);
		expect(result.params).toEqual(["$1"]);
	});
});
