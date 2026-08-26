import { schema, select, table, text, uuid } from "@hejbro/core";
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
});
