import { eq, schema, select, table, text, uuid, withCte } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compile/compile";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

describe("with compile (add-ctes task 5.1/5.2)", () => {
	it("a with statement compiles and reports its body's kind", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id }, ranked);
		});
		const result = compile(stage);
		expect(result.kind).toBe("select");
		expect(result.sql).toBe(
			'with "ranked" as (select "id", "status" from "app"."posts") select "ranked"."id" as "id" from "ranked"',
		);
		expect(result.params).toEqual([]);
	});

	it("literals inside a CTE body are bound before the body statement's, and no literal is inlined", () => {
		const stage = withCte((w) => {
			const ranked = w.as(
				"ranked",
				select(posts).where(eq(posts.status, "draft")),
			);
			return select({ id: ranked.id, status: ranked.status }, ranked).where(
				eq(ranked.status, "published"),
			);
		});
		const result = compile(stage);
		expect(result.sql).toBe(
			'with "ranked" as (select "id", "status" from "app"."posts" where "app"."posts"."status" = $1) select "ranked"."id" as "id", "ranked"."status" as "status" from "ranked" where "ranked"."status" = $2',
		);
		expect(result.params).toEqual(["draft", "published"]);
		// neither literal is spliced into the SQL text as raw text -- both
		// are bind parameters, in declaration order (entry, then body).
		expect(result.sql).not.toContain("draft");
		expect(result.sql).not.toContain("published");
	});
});
