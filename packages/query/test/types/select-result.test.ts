import type { CteRowEnvironment, Expr } from "@hejbro/core";
import {
	bigint,
	columnRef,
	type count,
	json,
	jsonb,
	lag,
	max,
	over,
	pgEnum,
	schema,
	serial,
	type sum,
	table,
	type tableMeta,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { SelectResult } from "../../src/types/select-result";

const shop = schema("shop");
const postStatus = pgEnum(shop, "post_status", ["draft", "published"]);

type Payload = { readonly kind: "widget" };

const posts = table(shop, "posts", {
	// F7 case 1: primaryKey() implies notNull (task 3.16) -- select side.
	id: uuid().primaryKey(),
	title: text(),
	titleRequired: text().notNull(),
	status: postStatus.column(),
	tags: text().array(),
	// composite 1: notNull + array together.
	tagsRequired: text().notNull().array(),
	amount: bigint({ mode: "number" }),
	// composite 2: mode + notNull together.
	amountRequired: bigint({ mode: "number" }).notNull(),
	payload: jsonb().$type<Payload>(),
	// composite 3: $type brand + notNull together.
	payloadRequired: jsonb().$type<Payload>().notNull(),
	payloadUnbranded: jsonb(),
	// json brand case (planner addition 1) -- json must behave like jsonb.
	payloadJson: json().$type<Payload>(),
	payloadJsonUnbranded: json(),
	// F7 case 2 / composite 4: serial's implied notNull (task 3.16) -- select side.
	sn: serial().primaryKey(),
});

type Posts = typeof posts;

// Two more tables for task 2.3's membership check, with DELIBERATELY
// different column maps (not just different names on the same shape) --
// a structural collision here would make the membership test prove
// nothing, since two column maps that happen to be structurally
// identical are the same TYPE to TypeScript regardless of which table()
// call produced them.
const comments = table(shop, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	body: text().notNull(),
});

const reactions = table(shop, "reactions", {
	id: uuid().primaryKey(),
	targetId: uuid().notNull(),
	kind: text().notNull(),
	weight: bigint({ mode: "number" }).notNull(),
});

// task 2.5: `comments`'s own column map, structurally, plus one extra
// column -- a genuine structural SUPERSET of `comments`, not merely a
// different shape. This is what a one-directional `extends` membership
// check cannot tell apart from `comments` itself (a superset always
// structurally extends its own subset).
const commentsWithExtra = table(shop, "comments_with_extra", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	body: text().notNull(),
	extra: text(),
});

describe("select-result (D1/D3/D5, task 3.10) -- whole-table projection", () => {
	it("field consumption matrix: each TMeta field the result type actually reads", () => {
		// typeName.
		expectTypeOf<SelectResult<Posts>["title"]>().toEqualTypeOf<string | null>();

		// notNull: same typeName, notNull flips null away (positive/negative contrast).
		expectTypeOf<
			SelectResult<Posts>["titleRequired"]
		>().toEqualTypeOf<string>();

		// element: array() wraps the base mapping (nullable since `tags` isn't
		// notNull); elements themselves carry `| null` (#349 -- Postgres
		// arrays are element-nullable regardless of the column's own notNull).
		expectTypeOf<SelectResult<Posts>["tags"]>().toEqualTypeOf<ReadonlyArray<
			string | null
		> | null>();

		// mode: bigint({mode:'number'}) reads as number, not the 'bigint' default.
		expectTypeOf<SelectResult<Posts>["amount"]>().toEqualTypeOf<
			number | null
		>();

		// jsonType (brand): jsonb().$type<Payload>() reads as Payload, not unknown.
		expectTypeOf<
			SelectResult<Posts>["payload"]
		>().toEqualTypeOf<Payload | null>();
		expectTypeOf<SelectResult<Posts>["payloadUnbranded"]>().toEqualTypeOf<
			unknown | null
		>();

		// hasDefault: not applicable to select (see select-result.ts's own
		// tsdoc) -- deliberately no case here; it's task 3.11's matrix entry.
	});

	it("json().$type<T>() brands exactly like jsonb().$type<T>() (planner addition 1 -- catches any leftover json-is-special-cased-unbranded artifact from the pre-relocation implementation)", () => {
		expectTypeOf<
			SelectResult<Posts>["payloadJson"]
		>().toEqualTypeOf<Payload | null>();
		expectTypeOf<SelectResult<Posts>["payloadJsonUnbranded"]>().toEqualTypeOf<
			unknown | null
		>();
	});

	it("enum column consumption (#422): pgEnum().column() reads as its declared values", () => {
		// Was `string | null` (planner addition 4, add-query-layer): pgEnum
		// took `ReadonlyArray<string>` and was not generic, so the values
		// sitting at the call site never reached the type system and every
		// string type-checked as a status. #422 carries them through.
		expectTypeOf<SelectResult<Posts>["status"]>().toEqualTypeOf<
			"draft" | "published" | null
		>();
	});

	it("F7 settlement (select side): uuid().primaryKey() and serial().primaryKey() are not null", () => {
		expectTypeOf<SelectResult<Posts>["id"]>().toEqualTypeOf<string>();
		expectTypeOf<SelectResult<Posts>["sn"]>().toEqualTypeOf<number>();
	});

	it("composite cases: accumulated TMeta arrives intact, not just one field at a time", () => {
		expectTypeOf<SelectResult<Posts>["tagsRequired"]>().toEqualTypeOf<
			ReadonlyArray<string | null>
		>();
		expectTypeOf<
			SelectResult<Posts>["amountRequired"]
		>().toEqualTypeOf<number>();
		expectTypeOf<
			SelectResult<Posts>["payloadRequired"]
		>().toEqualTypeOf<Payload>();
		// sn (serial().primaryKey()) already covers composite 4 in the F7 case above.
	});

	it("every declared column is present -- the whole-table form never drops or adds a key", () => {
		// keyof Posts also carries the hidden tableMeta symbol (Table's own
		// declaration-metadata key, D15) -- excluded here since
		// SelectResult only ever reflects declared columns.
		expectTypeOf<keyof SelectResult<Posts>>().toEqualTypeOf<
			Exclude<keyof Posts, typeof tableMeta>
		>();
	});
});

describe("select-result -- object projection (task 3.10)", () => {
	it("projection accuracy: only the projected keys exist on the result", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.title }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
		// @ts-expect-error "email" was never projected -- not a key of Proj.
		type _Rejected = Proj["email"];
	});

	it("honest widening: notNull is unknown from an Expr alone, so even a notNull-sourced column widens to nullable (contrast with the whole-table form's own titleRequired: string above)", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
	});

	it("a projected table column keeps its declared type (#311)", () => {
		// Was the family-only fallback: "numeric" covers every mode, so a
		// mode-'number' bigint read back as number|bigint|string. The origin
		// brand TableColumns already stamps on every column ref carries the
		// declaring column map and key, so the declared type is recoverable
		// without a name match.
		type AmountProj = SelectResult<{ readonly a: typeof posts.amountRequired }>;
		expectTypeOf<AmountProj>().toEqualTypeOf<{ readonly a: number | null }>();

		type PayloadProj = SelectResult<{
			readonly p: typeof posts.payloadRequired;
		}>;
		expectTypeOf<PayloadProj>().toEqualTypeOf<{ readonly p: Payload | null }>();

		type TagsProj = SelectResult<{ readonly t: typeof posts.tags }>;
		expectTypeOf<TagsProj>().toEqualTypeOf<{
			readonly t: ReadonlyArray<string | null> | null;
		}>();
	});

	it("a projected enum column reads as its declared values (#422 x #311)", () => {
		// The two changes were developed independently: #311 recovers the
		// declaring column through the origin brand, #422 puts the enum's
		// values on that column's meta. Composed, a projected enum keeps its
		// literal union instead of collapsing to the "text" family's string.
		type Proj = SelectResult<{ readonly s: typeof posts.status }>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly s: "draft" | "published" | null;
		}>();
	});

	it("the one-argument form stays fully widened by default (narrow-join-nullability, task 2.4) -- #307 is landed (2.1-2.3 above), but ONLY when a caller actually supplies TLeftJoined", () => {
		// Not a residual gap: `TLeftJoined` defaults to `UntrackedJoins`
		// (`unknown`), and `IsTrackedLeftJoinedSet<unknown>` is `false` by
		// construction (the frozen contract's own "untracked wins"), so a
		// caller who never names the second argument -- exactly this
		// one-argument form -- gets the pre-#307 widening unchanged. Only
		// `@hejbro/query`'s chain surface (G3) is positioned to know which
		// tables a statement actually left-joined and pass that set in.
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
	});

	it("a non-column expression still falls back to its family", () => {
		type Proj = SelectResult<{ readonly n: Expr<"numeric"> }>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly n: number | bigint | string | null;
		}>();
	});
});

describe("select-result narrows per field when the left-joined set is tracked (narrow-join-nullability, task 2.1)", () => {
	it("a direct notNull column narrows to non-null when the tracked set is never (nothing left-joined)", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }, never>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<string>();
	});
});

describe("`any` flowing into the left-joined set is judged untracked (narrow-join-nullability, task 2.4, frozen contract's `any` clause)", () => {
	// The membership matcher must not be optimized around "untracked means
	// literally `unknown`" -- `any` accepts (and is accepted by) every
	// `extends` check, so `[UntrackedJoins] extends [any]` is also `true`.
	// Fail-safe direction either way: a set that arrives as `any` widens.
	it("a notNull column stays nullable when the tracked set is any", () => {
		// biome-ignore lint/suspicious/noExplicitAny: the frozen contract's own any-flows-in-untracked case, not a house `any`.
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }, any>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<string | null>();
	});
});

describe("narrowing is restricted to a direct column reference (narrow-join-nullability, task 2.2)", () => {
	// Both max(...) and over(lag(...), ...) resolve through the SAME
	// `Aggregated<TExpr>` mechanism (`expr/aggregate.ts`/`expr/window.ts`):
	// the origin brand survives (Omit only strips `exprNode`/`sqlName`),
	// but the re-added `exprNode` is the WIDE `ExprNode` union, not
	// `ColumnRefNode` -- exactly the shape 2.1's own narrowing (keyed only
	// on the origin brand's presence) could not tell apart from a real
	// column reference.
	const aggregated = { m: max(posts.amountRequired) };
	const windowed = {
		w: over(lag(posts.titleRequired), {
			partitionBy: [posts.id],
			orderBy: [posts.id],
		}),
	};

	it("max(notNull column) stays nullable even when the tracked set is never", () => {
		type Proj = SelectResult<typeof aggregated, never>;
		expectTypeOf<Proj["m"]>().toEqualTypeOf<number | null>();
	});

	it("over(lag(notNull column), spec) stays nullable even when the tracked set is never", () => {
		type Proj = SelectResult<typeof windowed, never>;
		expectTypeOf<Proj["w"]>().toEqualTypeOf<string | null>();
	});

	it("an origin-less expression stays at its family fallback even when the tracked set is never (reviewer-flagged condition 2: no origin brand means nothing to narrow, tracked or not)", () => {
		// Condition 2 (the frozen contract's own four) isolated from
		// condition 1: a hand-built `columnRef()` DOES satisfy condition 1
		// (its `exprNode` is a real `ColumnRefNode`, so `IsDirectColumnRef`
		// is `true`) but was never stamped with `columnOriginBrand` --
		// nothing produced it from a table's own `TableColumns`. A mutant
		// that dropped condition 2 (narrowing on `IsDirectColumnRef` alone)
		// would narrow this to `string`; the honest answer is the flat
		// family fallback, since there is no declared column to recover.
		const handBuilt = {
			n: columnRef("app", "posts", "slug", { typeName: "text" }),
		};
		type Proj = SelectResult<typeof handBuilt, never>;
		expectTypeOf<Proj["n"]>().toEqualTypeOf<string | null>();
	});
});

describe("narrowing checks the origin's OWN table against the tracked set (narrow-join-nullability, task 2.3)", () => {
	const projected = { b: comments.body };

	it("a notNull column stays nullable when its OWN table is the tracked set (comments was left-joined)", () => {
		type Proj = SelectResult<typeof projected, typeof comments>;
		expectTypeOf<Proj["b"]>().toEqualTypeOf<string | null>();
	});

	it("the same notNull column narrows when a DIFFERENT table is the tracked set (reactions was left-joined, not comments)", () => {
		type Proj = SelectResult<typeof projected, typeof reactions>;
		expectTypeOf<Proj["b"]>().toEqualTypeOf<string>();
	});

	it("a self left-join stays nullable -- the projection's own from-table left-joined against itself is still a match (reviewer-flagged structural-collision case: widening is the correct answer here, narrowing would be the violation)", () => {
		const projectedPosts = { t: posts.titleRequired };
		type Proj = SelectResult<typeof projectedPosts, typeof posts>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<string | null>();
	});
});

describe("membership uses mutual equality, not one-directional extends (narrow-join-nullability, task 2.5)", () => {
	it("a structurally-superset table does not match the tracked table it structurally extends", () => {
		// `commentsWithExtra`'s own column map structurally extends
		// `comments`'s (superset extends subset), but they are different
		// tables. A one-directional `[origin] extends [member]` check would
		// wrongly call this a match and over-widen; only `comments` was
		// actually left-joined here, so a field from `commentsWithExtra`
		// must still narrow.
		const projected = { b: commentsWithExtra.body };
		type Proj = SelectResult<typeof projected, typeof comments>;
		expectTypeOf<Proj["b"]>().toEqualTypeOf<string>();
	});
});

describe("aggregate result types (#416)", () => {
	it("count reads as bigint, not the numeric family's union", () => {
		type Proj = SelectResult<{ readonly total: ReturnType<typeof count> }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly total: bigint | null }>();
	});

	it("min and max keep the argument's own declared type", () => {
		type Proj = SelectResult<{
			readonly biggest: ReturnType<typeof max<typeof posts.amount>>;
		}>;
		// posts.amount is bigint({ mode: "number" }) -- the aggregate carries
		// the column's origin through, so this is the declared read type, not
		// the family union.
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly biggest: number | null }>();
	});

	it("sum and avg stay at the family's widest honest type", () => {
		// Postgres promotes sum/avg by the argument's exact type (sum(int4) is
		// int8, sum(int8) is numeric, avg(int) is numeric), so one declared
		// result type would be wrong for most inputs.
		type Proj = SelectResult<{ readonly total: ReturnType<typeof sum> }>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly total: number | bigint | string | null;
		}>();
	});
});

describe("a withCte() reference's read type (add-ctes task 3.2)", () => {
	// A CTE-sourced select always goes through SelectResult's object-projection
	// branch (a CTE reference is never a Table), so what matters is what each
	// CteFieldRef carries into ProjectedColumnResult/OriginColumn.
	it("a whole-table entry's field keeps the declared type, not the bare family", () => {
		type Ranked = CteRowEnvironment<typeof posts>;
		type Proj = SelectResult<{ readonly a: Ranked["amountRequired"] }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly a: number | null }>();
	});

	it("an object-projected computed field keeps its ReadAs brand outside the CTE", () => {
		type Ranked = CteRowEnvironment<{
			readonly rn: ReturnType<typeof count>;
		}>;
		type Proj = SelectResult<{ readonly r: Ranked["rn"] }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly r: bigint | null }>();
	});
});
