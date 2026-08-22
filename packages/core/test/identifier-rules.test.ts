import { describe, expect, it } from "vitest";
import { schema, table, text } from "../src";
import { assertSqlName } from "../src/sql/identifier-rules";

describe("assertSqlName", () => {
	it("accepts snake_case names", () => {
		expect(assertSqlName("blog_posts", "table", null)).toBe("blog_posts");
	});
	it("rejects dots, equals, uppercase, and leading digits", () => {
		const bad = ["weird.col", "a=b", "Posts", "1st", ""];
		bad.map((name) =>
			expect(() => assertSqlName(name, "column", null)).toThrowError(
				expect.objectContaining({ code: "invalid-sql-name" }),
			),
		);
	});
});

describe("declaration-time validation", () => {
	it("schema() rejects invalid names", () => {
		expect(() => schema("My.Schema")).toThrowError(
			expect.objectContaining({ code: "invalid-sql-name" }),
		);
	});
	it("table() rejects a column whose snake_case name is still invalid", () => {
		const app = schema("app");
		expect(() => table(app, "posts", { "weird.col": text() })).toThrowError(
			expect.objectContaining({ code: "invalid-sql-name" }),
		);
	});
});
