import { schema, select, table, text, timestamptz, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("compile", () => {
	it("same statement compiles byte-identical twice, no connection", () => {
		// no database client, no connection string, no env var is touched
		// anywhere in this test — compile() is a pure function.
		const statement = select(posts);

		const first = compile(statement);
		const second = compile(statement);

		expect(first.sql).toBe(second.sql);
		expect(first.sql).toBe(
			'select "id", "status", "published_at" from "app"."posts"',
		);
		expect(first.sql).not.toContain("*");
		expect(first.params).toEqual([]);
		expect(second.params).toEqual([]);
		expect(first.kind).toBe("select");

		// the contract is byte-identical output for identical input, not
		// object identity — a separately built equivalent statement must
		// compile to the same text, not just repeated compiles of one object.
		expect(compile(select(posts)).sql).toBe(first.sql);
	});

	it("also accepts a bare QueryNode, not just a builder stage", () => {
		const bareNode = select(posts).selectQuery;

		expect(compile(bareNode)).toEqual({
			sql: 'select "id", "status", "published_at" from "app"."posts"',
			params: [],
			kind: "select",
		});
	});
});
