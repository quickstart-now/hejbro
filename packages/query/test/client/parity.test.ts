import { schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractTableMeta } from "../../src/client/contract-types";
import { synthesizeTable } from "../../src/client/synthesize";
import { compile } from "../../src/compile/compile";

/**
 * The compiled SQL equals what the declaration-based path compiles for
 * the same query (R2-G6 6.5) — this group's own real proof, per the
 * planner's own emphasis: without it, a client could be "typed right but
 * wired to different SQL". Proven at the `synthesizeTable` seam directly
 * (not through the name-keyed wrapper, which awaits immediately rather
 * than exposing `.compile()`) — this IS the exact value
 * `createNameKeyedDb` feeds `db()` internally, so a match here is a
 * match for the real client too.
 */
describe("the compiled SQL equals the declaration-based path (R2-G6 6.5)", () => {
	it("select compiles to the same SQL and params", () => {
		const app = schema("app");
		const declaredPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declaredCompiled = compile(select(declaredPosts));

		const meta: ContractTableMeta = {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				title: {
					sqlName: "title",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		};
		const synthesizedPosts = synthesizeTable(meta);
		const synthesizedCompiled = compile(select(synthesizedPosts));

		expect(synthesizedCompiled.sql).toBe(declaredCompiled.sql);
		expect(synthesizedCompiled.params).toEqual(declaredCompiled.params);
	});
});
