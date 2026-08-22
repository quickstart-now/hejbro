import { describe, expect, it } from "vitest";
import { desc, index } from "../../src/dsl/index-builder";
import { schema } from "../../src/dsl/schema";
import type { IndexColumnDeclaration, IndexMethod } from "../../src/dsl/table";
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
			{ name: "created_at", desc: false, nulls: null, opclass: null },
			{ name: "published_at", desc: true, nulls: "first", opclass: null },
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

	it("rejects a predicate referencing another table's column", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "posts", { id: uuid() }, (t) => ({
				indexes: [index("bad").on(t.id).where(eq(other.n, "x"))],
			})),
		).toThrow(
			/index-predicate-foreign-column-ref|can only see this table's own columns/,
		);
	});

	it("validates explicit index names (#88 ride-along)", () => {
		expect(() => index("Bad Name")).toThrow(
			/invalid-sql-name|not a valid hejbro SQL identifier/,
		);
	});
});

// #284 Foundational (T002): the widened public types every US1/US2/US3 story
// depends on — no `.using()`/`op()`/expression-`.on()` behaviour yet (that's
// T014/T024/T036), just the shape and its default.
describe("index builder — Foundational types (#284)", () => {
	it("IndexDeclaration.method defaults to null (btree) until .using() lands (US1)", () => {
		const posts = table(app, "posts", { slug: text() }, (t) => ({
			indexes: [index("posts_slug_idx").on(t.slug)],
		}));
		expect(getTableMeta(posts).indexes[0]?.method).toBeNull();
	});

	it("IndexMethod is the closed eight-name union (D85)", () => {
		const methods: ReadonlyArray<IndexMethod> = [
			"btree",
			"hash",
			"gin",
			"gist",
			"spgist",
			"brin",
			"hnsw",
			"ivfflat",
		];
		expect(methods).toHaveLength(8);
	});

	it("IndexColumnDeclaration carries opclass alongside name/desc/nulls", () => {
		const byName: IndexColumnDeclaration = {
			name: "email",
			desc: false,
			nulls: null,
			opclass: null,
		};
		expect(byName.opclass).toBeNull();
	});

	// The expression-column variant (`.on(sql\`...\`)`, R5) lands in US3
	// (T036) — see IndexColumnDeclaration's doc comment (#284 Foundational
	// review).
});
