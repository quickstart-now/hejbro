import { eq, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile/compile";
import { sql } from "../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

describe("sql escape hatch (fragment form)", () => {
	it("interpolated value becomes a parameter, never a literal", () => {
		const statement = select({ tag: sql`${"value"}` }, posts);
		const result = compile(statement);

		expect(result.sql).toBe('select $1 as "tag" from "app"."posts"');
		expect(result.params).toEqual(["value"]);
	});

	it("an adversarial interpolation never appears in the SQL text, only in params", () => {
		const payload = "'; drop table users; --";
		const statement = select({ tag: sql`${payload}` }, posts);
		const result = compile(statement);

		expect(result.sql).not.toContain(payload);
		expect(result.params).toEqual([payload]);
	});

	it("nested fragments compose structurally, numbered by appearance order", () => {
		const statement = select({ tag: sql`a ${sql`b ${1}`} ${2}` }, posts);
		const result = compile(statement);

		expect(result.sql).toBe('select a b $1 $2 as "tag" from "app"."posts"');
		expect(result.params).toEqual([1, 2]);
	});

	it("sql.identifier doubles an embedded double quote", () => {
		const statement = select({ ref: sql.identifier("app", 'we"ird') }, posts);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select "app"."we""ird" as "ref" from "app"."posts"',
		);
		expect(result.params).toEqual([]);
	});

	it("sql.raw() stays verbatim where the same text as a value would be parameterized", () => {
		const text = "now()";
		const rawStatement = select({ tag: sql.raw(text) }, posts);
		const valueStatement = select({ tag: sql`${text}` }, posts);

		const rawResult = compile(rawStatement);
		const valueResult = compile(valueStatement);

		expect(rawResult.sql).toBe('select now() as "tag" from "app"."posts"');
		expect(rawResult.params).toEqual([]);

		expect(valueResult.sql).toBe('select $1 as "tag" from "app"."posts"');
		expect(valueResult.params).toEqual([text]);
	});

	it("a fragment's literal and another clause's literal share one continuous sequence", () => {
		// Proves the fragment rides the existing lift pipeline rather than a
		// separate one of its own: a private renderer for `sql` would number
		// from $1 again instead of continuing where the projection left off,
		// and `params` alone can't show that — only the SQL text can.
		const statement = select({ tag: sql`${"a"}` }, posts).where(
			eq(posts.status, "b"),
		);
		const result = compile(statement);

		expect(result.sql).toBe(
			'select $1 as "tag" from "app"."posts" where "app"."posts"."status" = $2',
		);
		expect(result.params).toEqual(["a", "b"]);
	});
});

describe("sql escape hatch (statement form)", () => {
	it("compiles a sql template directly as a whole statement", () => {
		const result = compile(sql`select 1`);

		expect(result.sql).toBe("select 1");
		expect(result.params).toEqual([]);
		expect(result.kind).toBe("sql");
	});

	it("parameterizes a value interpolated into a statement-form template", () => {
		const result = compile(sql`select ${"value"}`);

		expect(result.sql).toBe("select $1");
		expect(result.params).toEqual(["value"]);
		expect(result.kind).toBe("sql");
	});

	it("throws empty-sql-statement for a blank statement", () => {
		expect(() => compile(sql``)).toThrow(
			expect.objectContaining({ code: "empty-sql-statement" }),
		);
	});
});
