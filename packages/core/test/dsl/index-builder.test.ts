import { describe, expect, it } from "vitest";
import { desc, index } from "../../src/dsl/index-builder";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, isNotNull } from "../../src/expr/operators";
import { exists, select } from "../../src/query/select";
import {
	text,
	timestamptz,
	uuid,
} from "../../src/types/column-builder-factories";

const app = schema("app");

describe("index builder — ordering and partial predicates", () => {
	it("records direction and nulls per column", () => {
		const posts = table(
			app,
			"posts",
			{ createdAt: timestamptz(), publishedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("posts_recent_idx").on(
						t.createdAt,
						desc(t.publishedAt, { nulls: "first" }),
					),
				],
			}),
		);
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{ name: "created_at", desc: false, nulls: null },
			{ name: "published_at", desc: true, nulls: "first" },
		]);
	});

	it("records a where predicate after on()", () => {
		const posts = table(
			app,
			"posts",
			{ slug: text(), publishedAt: timestamptz() },
			(t) => ({
				indexes: [
					index("posts_slug_published_uidx")
						.unique()
						.on(t.slug)
						.where(isNotNull(t.publishedAt)),
				],
			}),
		);
		const [ix] = getTableMeta(posts).indexes;
		expect(ix?.unique).toBe(true);
		expect(ix?.predicate?.nodeKind).toBe("nullTest");
	});

	it("validates the predicate like a check", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				indexes: [
					index("bad")
						.on(t.id)
						.where(exists(select(other).where(eq(other.id, t.id)))),
				],
			})),
		).toThrow(
			/index-predicate-subquery|Postgres forbids subqueries in a partial index's WHERE clause/,
		);
	});

	it("validates explicit index names (#88 ride-along)", () => {
		expect(() => index("Bad Name")).toThrow(
			/invalid-sql-name|not a valid hejbro SQL identifier/,
		);
	});
});
