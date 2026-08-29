import { describe, expect, it } from "vitest";
import { defineView } from "../../src/dsl/define-view";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import type { WithNode } from "../../src/expr/ast";
import type { ViewSnapshot } from "../../src/kinds/view-kind";
import { viewKind, viewQueryColumns } from "../../src/kinds/view-kind";
import { select } from "../../src/query/select";
import { withCte } from "../../src/query/with";
import type { ColumnOrderOracle } from "../../src/snapshot/column-order";
import { applyColumnOrderToQuery } from "../../src/snapshot/column-order";
import { text, uuid } from "../../src/types/column-builder-factories";

/** Narrows a `ViewDeclaration.query` to `WithNode` -- the tests in this file build one on purpose, but the field's own type stays the full union. */
const asWithNode = (query: { readonly queryKind: string }): WithNode => {
	if (query.queryKind !== "with") {
		throw new Error("expected a WithNode");
	}
	return query as WithNode;
};

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

describe("defineView accepts a body that declares a CTE (add-ctes task 4.1)", () => {
	it("a view whose body declares a CTE reports the body's columns", () => {
		const view = defineView(
			app,
			"ranked_posts",
			withCte((w) => {
				const ranked = w.as("ranked", select(posts));
				return select({ id: ranked.id }, ranked);
			}),
		);
		expect(view.query.queryKind).toBe("with");
		expect(viewQueryColumns(view.query)).toEqual(["id"]);
	});

	it("a view whose body is a set operation over a CTE-declaring statement still reports the leftmost body's columns", () => {
		const view = defineView(
			app,
			"ranked_posts_union",
			withCte((w) => {
				const ranked = w.as("ranked", select(posts));
				return select({ id: ranked.id }, ranked).union(
					select({ id: posts.id }, posts),
				);
			}),
		);
		expect(view.query.queryKind).toBe("with");
		expect(viewQueryColumns(view.query)).toEqual(["id"]);
	});
});

describe("column order reaches through a CTE-declaring view's WITH wrapper (add-ctes task 4.2)", () => {
	const oracle: ColumnOrderOracle = (ref) => {
		if (ref.schemaName === "app" && ref.tableName === "posts") {
			return ["status", "id"];
		}
		return null;
	};

	it("column order applies to both the body and every entry's own whole-table projection (add-ctes task 4.2b) -- an entry's body is a plain select over a real table, with a physical order of its own, unlike a CTE reference", () => {
		const view = defineView(
			app,
			"posts_with_ranked",
			withCte((w) => {
				w.as("ranked", select(posts));
				return select(posts);
			}),
		);
		const reordered = asWithNode(applyColumnOrderToQuery(view.query, oracle));
		expect(reordered).not.toBe(view.query);
		expect(reordered.body).toMatchObject({
			projection: {
				projectionKind: "allColumns",
				columnNames: ["status", "id"],
			},
		});
		expect(reordered.ctes[0]?.query).toMatchObject({
			projection: {
				projectionKind: "allColumns",
				columnNames: ["status", "id"],
			},
		});
		expect(reordered.ctes).not.toBe(asWithNode(view.query).ctes);
	});

	it("a CTE reference as the body's from-source is left alone, even though the entry behind it still reorders", () => {
		const view = defineView(
			app,
			"ranked_only",
			withCte((w) => {
				const ranked = w.as("ranked", select(posts));
				return select({ id: ranked.id }, ranked);
			}),
		);
		const reordered = asWithNode(applyColumnOrderToQuery(view.query, oracle));
		// an object projection is never allColumns -- nothing for the
		// oracle to touch, so the body keeps reference identity...
		expect(reordered.body).toBe(asWithNode(view.query).body);
		// ...but the entry behind the reference is a plain select(posts),
		// which does reorder (task 4.2b), so the node as a whole still
		// changes.
		expect(reordered).not.toBe(view.query);
		expect(reordered.ctes[0]?.query).toMatchObject({
			projection: {
				projectionKind: "allColumns",
				columnNames: ["status", "id"],
			},
		});
	});

	it("nothing changes when the oracle already agrees with declaration order everywhere -- both the wrapper and every entry keep reference identity", () => {
		const inertOracle: ColumnOrderOracle = () => null;
		const view = defineView(
			app,
			"posts_with_ranked_inert",
			withCte((w) => {
				w.as("ranked", select(posts));
				return select(posts);
			}),
		);
		expect(applyColumnOrderToQuery(view.query, inertOracle)).toBe(view.query);
	});

	it("viewKind.serialize applies the same reorder through view-kind.ts's own wrapper-unwrapping path (not just column-order.ts's)", () => {
		const view = defineView(
			app,
			"posts_with_ranked_serialized",
			withCte((w) => {
				w.as("ranked", select(posts));
				return select(posts);
			}),
		);
		const snapshot = viewKind.serialize(view, {
			columnOrder: oracle,
		}) as ViewSnapshot;
		expect(snapshot.columns).toEqual(["status", "id"]);
	});
});
