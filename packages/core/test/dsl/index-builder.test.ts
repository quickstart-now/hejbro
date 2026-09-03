import { describe, expect, it } from "vitest";
import { asc, desc, index, op } from "../../src/dsl/index-builder";
import { schema } from "../../src/dsl/schema";
import type { IndexColumnDeclaration, IndexMethod } from "../../src/dsl/table";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, isNotNull } from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import { tableKind } from "../../src/kinds/table-kind";
import { asTableSnapshot } from "../../src/kinds/table-snapshot";
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
		const origin = { schemaName: "app", tableName: "posts" };
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{ name: "created_at", origin, desc: false, nulls: null, opclass: null },
			{
				name: "published_at",
				origin,
				desc: true,
				nulls: "first",
				opclass: null,
			},
		]);
	});

	it("asc()/desc() still declare an index column exactly as before (group 5's no-regression pin, #470)", () => {
		// IndexColumn now extends the shared OrderedTerm (expr/ast.ts) --
		// a type-only change (group 5.1); asc()/desc() themselves, and
		// everything toDeclarationColumn does with their result, are
		// untouched. This pins the declaration-side shape byte-for-byte
		// against that refactor.
		const posts = table(app, "posts", { publishedAt: timestamptz() }, (t) => ({
			indexes: [
				index("posts_published_idx").on(asc(t.publishedAt, { nulls: "last" })),
			],
		}));
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{
				name: "published_at",
				origin: { schemaName: "app", tableName: "posts" },
				desc: false,
				nulls: "last",
				opclass: null,
			},
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

// #464: `.on()`'s column list had no table-ownership check — the one
// declaration site out of four that silently accepted a column ref from
// another table. 2.1 preserves the origin a plain column ref was resolved
// from (declaration-side only); 2.2 uses it to refuse a foreign column,
// joining the `foreign-column-ref` family the CTE guard in
// `dsl/index-builder.ts` and the FK guards already form.
describe("index builder — plain column origin (#464)", () => {
	it("an index column keeps the table it came from", () => {
		const posts = table(app, "posts", { slug: text() }, (t) => ({
			indexes: [index("posts_slug_idx").on(t.slug)],
		}));
		const [column] = getTableMeta(posts).indexes[0]?.columns ?? [];
		expect(column && "origin" in column && column.origin).toEqual({
			schemaName: "app",
			tableName: "posts",
		});
	});

	it("the serialized index column is unchanged by that", () => {
		const posts = table(app, "posts", { slug: text() }, (t) => ({
			indexes: [index("posts_slug_idx").on(t.slug)],
		}));
		const snapshot = asTableSnapshot(tableKind.serialize(getTableMeta(posts)));
		const [indexSnapshot] = snapshot.indexes;
		expect(indexSnapshot?.columns).toEqual([{ name: "slug" }]);
	});

	it("rejects an index over another table's column", () => {
		const other = table(app, "other", { n: text() });
		expect(() =>
			table(app, "posts", { id: uuid() }, () => ({
				indexes: [index("bad").on(other.n)],
			})),
		).toThrow(
			/foreign-column-ref|an index can only use this table's own columns/,
		);
	});

	it("rejects an index over another table's column that shares a name with one of its own", () => {
		const other = table(app, "other", { id: uuid() });
		expect(() =>
			table(app, "posts", { id: uuid() }, () => ({
				indexes: [index("bad").on(other.id)],
			})),
		).toThrow(
			/foreign-column-ref|an index can only use this table's own columns/,
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
			origin: { schemaName: "app", tableName: "posts" },
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

// #284 US1 (T010): access method — `.using(method)` records/normalizes
// `method`, rejects an unknown method, and rejects `unique()` combined with
// a non-btree method (Postgres: "Only B-tree indexes can be declared
// unique", R3).
describe("index builder — access method (#284 US1)", () => {
	it("using(method) records the method", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").using("gin").on(t.data)],
		}));
		expect(getTableMeta(posts).indexes[0]?.method).toBe("gin");
	});

	it("using(btree) normalizes to method: null (SC-004 — btree is never recorded)", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").using("btree").on(t.data)],
		}));
		expect(getTableMeta(posts).indexes[0]?.method).toBeNull();
	});

	it("using() and unique() compose regardless of call order", () => {
		const usingThenUnique = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").using("btree").unique().on(t.data)],
		}));
		const uniqueThenUsing = table(app, "comments", { data: text() }, (t) => ({
			indexes: [index("comments_data_idx").unique().using("btree").on(t.data)],
		}));
		const [byUsingFirst] = getTableMeta(usingThenUnique).indexes;
		const [byUniqueFirst] = getTableMeta(uniqueThenUsing).indexes;
		expect(byUsingFirst?.method).toBeNull();
		expect(byUsingFirst?.unique).toBe(true);
		expect(byUniqueFirst?.method).toBeNull();
		expect(byUniqueFirst?.unique).toBe(true);
	});

	it("rejects an unknown access method with the eight-name list", () => {
		// R2: `.using()` also runtime-checks its argument for untyped callers
		// — assert from `string`, not a narrower literal, so the cast itself
		// exercises that path rather than merely satisfying the compiler.
		const untypedMethod: string = "gim";
		expect(() => index("bad").using(untypedMethod as IndexMethod)).toThrow(
			/index access method "gim" is not one hejbro accepts — supported: btree, hash, gin, gist, spgist, brin, hnsw, ivfflat\. Next: pick one of those/,
		);
	});

	it("rejects .unique().using(<non-btree>).on(...) — named index", () => {
		expect(() =>
			table(app, "posts", { data: text() }, (t) => ({
				indexes: [index("posts_data_idx").unique().using("gin").on(t.data)],
			})),
		).toThrow(
			/index "posts_data_idx" is unique and uses "gin" — Postgres supports unique only on btree indexes\. Next: drop \.unique\(\) or drop \.using\("gin"\)\./,
		);
	});

	it("rejects .using(<non-btree>).unique().on(...) — order-independent", () => {
		expect(() =>
			table(app, "posts", { data: text() }, (t) => ({
				indexes: [index("posts_data_idx").using("gin").unique().on(t.data)],
			})),
		).toThrow(
			/index "posts_data_idx" is unique and uses "gin" — Postgres supports unique only on btree indexes\. Next: drop \.unique\(\) or drop \.using\("gin"\)\./,
		);
	});

	it("rejects an unnamed unique + non-btree index, describing it by its columns", () => {
		expect(() =>
			table(app, "posts", { a: text(), b: text() }, (t) => ({
				indexes: [index().unique().using("gin").on(t.a, t.b)],
			})),
		).toThrow(
			/the unique index on \("a", "b"\) uses "gin" — Postgres supports unique only on btree indexes\. Next: drop \.unique\(\) or drop \.using\("gin"\)\./,
		);
	});
});

// #284 US2 (T020): operator class — `op(input, opclass)` composes with
// `asc(...)`/`desc(...)` in either order (R4); the opclass is a D36
// identifier, validated the same way an index name is.
describe("index builder — operator class (#284 US2)", () => {
	it("op(column, opclass) records the opclass", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [index("posts_data_idx").on(op(t.data, "text_pattern_ops"))],
		}));
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{
				name: "data",
				origin: { schemaName: "app", tableName: "posts" },
				desc: false,
				nulls: null,
				opclass: "text_pattern_ops",
			},
		]);
	});

	it("op(desc(column), opclass) keeps desc/nulls from the desc(...) wrap", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").on(
					op(desc(t.data, { nulls: "last" }), "text_pattern_ops"),
				),
			],
		}));
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{
				name: "data",
				origin: { schemaName: "app", tableName: "posts" },
				desc: true,
				nulls: "last",
				opclass: "text_pattern_ops",
			},
		]);
	});

	it("desc(op(column, opclass), { nulls }) keeps the opclass from the op(...) wrap", () => {
		const posts = table(app, "posts", { data: text() }, (t) => ({
			indexes: [
				index("posts_data_idx").on(
					desc(op(t.data, "text_pattern_ops"), { nulls: "first" }),
				),
			],
		}));
		expect(getTableMeta(posts).indexes[0]?.columns).toEqual([
			{
				name: "data",
				origin: { schemaName: "app", tableName: "posts" },
				desc: true,
				nulls: "first",
				opclass: "text_pattern_ops",
			},
		]);
	});

	it("rejects an invalid operator class name", () => {
		const posts = table(app, "posts", { data: text() });
		expect(() => op(posts.data, "bad-class")).toThrow(
			/invalid-sql-name|operator class name "bad-class" is not a valid hejbro SQL identifier/,
		);
	});
});

// #284 US3 (T030): expression indexes — `.on(sql\`…\`)` yields an
// `{ expression }` entry; `op(...)`/`desc(...)` compose over an expression
// the same way they do over a column ref (R5).
describe("index builder — expression columns (#284 US3)", () => {
	it(".on(sql`...`) yields an { expression } entry", () => {
		const posts = table(app, "posts", { email: text() }, (t) => ({
			indexes: [index("posts_email_lower_idx").on(sql`lower(${t.email})`)],
		}));
		const [column] = getTableMeta(posts).indexes[0]?.columns ?? [];
		expect(column && "expression" in column).toBe(true);
		expect(column?.desc).toBe(false);
		expect(column?.nulls).toBeNull();
		expect(column?.opclass).toBeNull();
	});

	it("op(sql`...`, opclass) composes over an expression", () => {
		const posts = table(app, "posts", { email: text() }, (t) => ({
			indexes: [
				index("posts_email_lower_idx").on(
					op(sql`lower(${t.email})`, "text_pattern_ops"),
				),
			],
		}));
		const [column] = getTableMeta(posts).indexes[0]?.columns ?? [];
		expect(column && "expression" in column).toBe(true);
		expect(column?.opclass).toBe("text_pattern_ops");
	});

	it("desc(sql`...`) composes over an expression", () => {
		const posts = table(app, "posts", { email: text() }, (t) => ({
			indexes: [
				index("posts_email_lower_idx").on(
					desc(sql`lower(${t.email})`, { nulls: "last" }),
				),
			],
		}));
		const [column] = getTableMeta(posts).indexes[0]?.columns ?? [];
		expect(column && "expression" in column).toBe(true);
		expect(column?.desc).toBe(true);
		expect(column?.nulls).toBe("last");
	});

	it("asc(op(sql`...`, opclass)) keeps the opclass from the op(...) wrap", () => {
		const posts = table(app, "posts", { email: text() }, (t) => ({
			indexes: [
				index("posts_email_lower_idx").on(
					asc(op(sql`lower(${t.email})`, "text_pattern_ops")),
				),
			],
		}));
		const [column] = getTableMeta(posts).indexes[0]?.columns ?? [];
		expect(column && "expression" in column).toBe(true);
		expect(column?.opclass).toBe("text_pattern_ops");
		expect(column?.desc).toBe(false);
	});
});
