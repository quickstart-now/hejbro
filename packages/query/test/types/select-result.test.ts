import type {
	CteFieldRef,
	CteRowEnvironment,
	Expr,
	RecursiveCteReference,
	UntrackedJoins,
	WidenedBy,
} from "@hejbro/core";
import {
	bigint,
	columnRef,
	type count,
	eq,
	integer,
	isNull,
	json,
	jsonArrayFrom,
	jsonb,
	jsonObjectFrom,
	lag,
	max,
	over,
	pgEnum,
	schema,
	select,
	serial,
	type sum,
	table,
	type tableMeta,
	text,
	uuid,
	withCte,
} from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compile } from "../../src/compile/compile";
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

	it("the mirror direction: a subset origin does not match a structurally-superset tracked table (reviewer-flagged asymmetry -- the previous case alone left a reverse one-directional extends undetected)", () => {
		// The previous case fixed origin=superset, member=subset. A mutant
		// that checks ONLY `[member] extends [origin]` (the reverse
		// direction) happens to give the right answer there too -- it only
		// diverges from mutual equality when the roles are swapped: origin
		// the SUBSET, tracked member the SUPERSET. That reverse-only check
		// would then see the superset member structurally extend the
		// subset origin and wrongly call it a match.
		type Proj = SelectResult<
			{ readonly b: typeof comments.body },
			typeof commentsWithExtra
		>;
		expectTypeOf<Proj["b"]>().toEqualTypeOf<string>();
	});
});

describe("a union tracked set (two leftJoin calls) distributes the membership check over every member (narrow-join-nullability, task 2.5 reviewer round)", () => {
	// `TLeftJoined extends Table<infer TMemberColumns> ? … : false`
	// distributes over a naked union one member at a time (the frozen
	// contract's own note in ColumnMapIsLeftJoinedMember's doc comment) --
	// this was never previously exercised with an ACTUAL union, only
	// `never`/a single `Table`. Two real left-joined tables is the actual
	// shape `leftJoin(...).leftJoin(...)` produces.
	type TrackedBoth = typeof comments | typeof reactions;
	const projected = {
		fromComments: comments.body,
		fromReactions: reactions.kind,
		fromPosts: posts.titleRequired,
	};

	it("a column from the FIRST union member stays nullable", () => {
		type Proj = SelectResult<typeof projected, TrackedBoth>;
		expectTypeOf<Proj["fromComments"]>().toEqualTypeOf<string | null>();
	});

	it("a column from the SECOND union member stays nullable", () => {
		type Proj = SelectResult<typeof projected, TrackedBoth>;
		expectTypeOf<Proj["fromReactions"]>().toEqualTypeOf<string | null>();
	});

	it("a column from a table NOT in the union narrows", () => {
		type Proj = SelectResult<typeof projected, TrackedBoth>;
		expectTypeOf<Proj["fromPosts"]>().toEqualTypeOf<string>();
	});
});

describe("a nullable column stays nullable when narrowing conditions are met (#546-fix, group-2 defect found during group 3, task 2.6)", () => {
	// Group 2's own tests never crossed "nullable column" with "actually
	// narrowing" -- every narrowing case (2.1/2.3/2.5/self-join/union) used
	// a notNull column, and every nullable-column case (the object-
	// projection describe block above) was either untracked or a tracked
	// member, so this specific combination went unexercised. Reviewer-
	// flagged scope expansion: four nullable SHAPES lose their `| null`
	// differently through the bare `ColumnTsType` bug (a plain scalar, a
	// numeric mode, a `$type` brand, and an array's own outer nullability
	// are four separate code paths in `ColumnReadType`/`BaseTsType`), so
	// one shape proves nothing about the other three.
	it("a plain nullable scalar (text) stays string | null", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.title }, never>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<string | null>();
	});

	it("a nullable numeric-mode column stays number | null", () => {
		type Proj = SelectResult<{ readonly a: typeof posts.amount }, never>;
		expectTypeOf<Proj["a"]>().toEqualTypeOf<number | null>();
	});

	it("a nullable $type-branded column stays Payload | null", () => {
		type Proj = SelectResult<{ readonly p: typeof posts.payload }, never>;
		expectTypeOf<Proj["p"]>().toEqualTypeOf<Payload | null>();
	});

	it("a nullable array column keeps its OWN outer null, on top of the array's own always-nullable elements", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.tags }, never>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<ReadonlyArray<
			string | null
		> | null>();
	});

	it("control: a notNull column still narrows to the bare type, unaffected by this fix", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }, never>;
		expectTypeOf<Proj["t"]>().toEqualTypeOf<string>();
	});
});

describe("the ReadAsType and member-match arms stay nullable by construction -- made observable, not assumed (task 2.6)", () => {
	it("ReadAsType arm (count()) stays bigint | null even under a tracked set", () => {
		type Proj = SelectResult<
			{ readonly total: ReturnType<typeof count> },
			never
		>;
		expectTypeOf<Proj["total"]>().toEqualTypeOf<bigint | null>();
	});

	it("member-match arm (condition 4 true) stays string | null even though every other condition holds", () => {
		const projected = { b: comments.body };
		type Proj = SelectResult<typeof projected, typeof comments>;
		expectTypeOf<Proj["b"]>().toEqualTypeOf<string | null>();
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

// #500/R2, #500/R3: a recursive CTE's outward row widens per key by the
// recursive term's own nullability -- `RecursiveCteReference`'s three
// generic parameters (anchor projection, recursive term's own
// projection, recursive term's own left-joined set) stand in for an
// actual `asRecursive` call here, the same type-only style this file
// already uses for `CteRowEnvironment` above. Every `SelectResult` call
// below pins its OWN `TLeftJoined` at `never` (the tracked empty set) --
// `db.with(...)`'s own body absorbs that parameter into the untracked
// default regardless (narrow-join-nullability task 3.4, already pinned
// in `chain-types.test.ts`, unrelated to this change and out of its
// scope), which would make every key nullable and hide the very
// distinction this table exists to draw.
describe("a recursive CTE's outward row widens by the recursive term's nullability (#500/R2, #500/R3, task 1.2)", () => {
	it("anchor non-null, recursive term nullable -> outward nullable", () => {
		type R = RecursiveCteReference<
			{ readonly v: typeof posts.amountRequired },
			{ readonly v: typeof posts.amount },
			never
		>;
		type Row = SelectResult<{ readonly v: R["v"] }, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("both branches non-null -> non-null", () => {
		type R = RecursiveCteReference<
			{ readonly v: typeof posts.amountRequired },
			{ readonly v: typeof posts.amountRequired },
			never
		>;
		type Row = SelectResult<{ readonly v: R["v"] }, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number>();
	});

	it("anchor nullable, recursive term non-null -> nullable (the anchor's own nullability still governs)", () => {
		type R = RecursiveCteReference<
			{ readonly v: typeof posts.amount },
			{ readonly v: typeof posts.amountRequired },
			never
		>;
		type Row = SelectResult<{ readonly v: R["v"] }, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("the recursive term projects the key through a window function -> nullable, a regression guard rather than evidence of the widening (over(...) already fails IsDirectColumnRef, so this is nullable with or without WidenedBy)", () => {
		type R = RecursiveCteReference<
			{ readonly v: typeof posts.amountRequired },
			{ readonly v: ReturnType<typeof over<typeof posts.amountRequired>> },
			never
		>;
		type Row = SelectResult<{ readonly v: R["v"] }, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("two keys, one widened and one not", () => {
		type R = RecursiveCteReference<
			{
				readonly id: typeof posts.amountRequired;
				readonly v: typeof posts.amountRequired;
			},
			{
				readonly id: typeof posts.amountRequired;
				readonly v: typeof posts.amount;
			},
			never
		>;
		type Row = SelectResult<
			{ readonly id: R["id"]; readonly v: R["v"] },
			never
		>;
		expectTypeOf<Row["id"]>().toEqualTypeOf<number>();
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("the recursive term projects a left-joined table's non-null column -> outward nullable (why the rule lives in @hejbro/query, not core)", () => {
		type R = RecursiveCteReference<
			{ readonly v: typeof posts.amountRequired },
			{ readonly v: typeof reactions.weight },
			typeof reactions
		>;
		type Row = SelectResult<{ readonly v: R["v"] }, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	// #500/R6 (review B1, corrected): a recursive term ending in a set
	// operation has no stage of its own to carry a left-joined set on --
	// `SetOpStage` never mixes in `LeftJoinedBrand` -- so its set is
	// UNKNOWN, and this repository's frozen contract reads an untracked
	// position as nullable. A key such a term projects from a column, or
	// from an expression that is not a nested read, reads nullable
	// outward, even one neither branch actually projects as nullable
	// (row R32) -- the delta's own exception, stated so the next reader
	// doesn't re-derive it. `never` was tried and withdrawn (#500/R6): it
	// would assert an empty set nobody measured and would drop a real
	// left join hiding inside a set-op branch (row F1).
	//
	// #500/R8: a key such a term projects THROUGH A NESTED READ does not
	// follow that untracked rule -- the value's own rule answers instead,
	// as it does everywhere else (row E2u).
	//
	// json()/jsonb() read as `unknown` regardless of `notNull` (#500/R7)
	// -- a row asserting non-null over a json-family column verifies
	// nothing (`null extends unknown` is always `true`); every non-null
	// row below uses a non-json anchor value instead.
	const rn6 = schema("rn6");
	const setOpTree = table(rn6, "set_op_tree", {
		id: integer().primaryKey(),
		parent: integer(),
		v: integer(),
		vReq: integer().notNull(),
	});
	const rn7 = schema("rn7");
	const child = table(rn7, "child", {
		id: integer().primaryKey(),
		tId: integer(),
		nameReq: text().notNull(),
	});
	const holder = table(rn7, "holder", {
		id: integer().primaryKey(),
		parent: integer(),
		vReq: integer().notNull(),
		blob: json(),
	});
	const f1Other = table(rn7, "f1_other", {
		id: integer().primaryKey(),
		tId: integer(),
		w: integer().notNull(),
	});

	it("R32 a set-op recursive term with both branches non-null still reads nullable outward (#500/R6 exception)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: setOpTree.id, v: setOpTree.vReq }, setOpTree).where(
					isNull(setOpTree.parent),
				),
				(self) =>
					select({ id: setOpTree.id, v: setOpTree.vReq }, self)
						.innerJoin(setOpTree, eq(self.id, setOpTree.parent))
						.union(
							select({ id: setOpTree.id, v: setOpTree.vReq }, setOpTree).where(
								isNull(setOpTree.id),
							),
						),
			);
			expectTypeOf(r.v).toEqualTypeOf<
				CteFieldRef<typeof setOpTree.vReq> &
					WidenedBy<typeof setOpTree.vReq, UntrackedJoins>
			>();
			return select({ id: r.id, v: r.v }, r);
		});
		const compiled = compile(stage);
		expect(compiled.sql).toContain("with recursive");
		expect(compiled.sql).toContain("union");
		type Row = SelectResult<typeof stage.projectionInput, never>;
		expectTypeOf<Row["id"]>().toEqualTypeOf<number | null>();
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("F1 a left join inside a set-op recursive term reads nullable outward even though the joined column is notNull (#500/R6 exception, #944)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select({ id: holder.id, v: holder.vReq }, holder).where(
					isNull(holder.parent),
				),
				(self) =>
					select({ id: holder.id, v: f1Other.w }, self)
						.innerJoin(holder, eq(self.id, holder.parent))
						.leftJoin(f1Other, eq(holder.id, f1Other.tId))
						.union(
							select({ id: holder.id, v: f1Other.w }, holder)
								.leftJoin(f1Other, eq(holder.id, f1Other.tId))
								.where(isNull(holder.id)),
						),
			);
			return select({ id: r.id, v: r.v }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		expectTypeOf<Row["v"]>().toEqualTypeOf<number | null>();
	});

	it("E2u a unionAll set-op recursive term projecting an array read stays non-null (#500/R8 -- unionAll, not union: Postgres refuses to compare json for equality)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{
						pid: holder.id,
						kids: jsonArrayFrom(
							select({ id: child.id, name: child.nameReq }, child),
						),
					},
					holder,
				).where(isNull(holder.parent)),
				(self) =>
					select(
						{
							pid: holder.id,
							kids: jsonArrayFrom(
								select({ id: child.id, name: child.nameReq }, child),
							),
						},
						self,
					)
						.innerJoin(holder, eq(self.pid, holder.parent))
						.unionAll(
							select(
								{
									pid: holder.id,
									kids: jsonArrayFrom(
										select({ id: child.id, name: child.nameReq }, child),
									),
								},
								holder,
							).where(isNull(holder.id)),
						),
			);
			return select({ pid: r.pid, kids: r.kids }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		// the value's own rule answers even under a set-op recursive term
		// (#500/R8): the untracked rule governs a column or a non-nested
		// expression, never a nested read.
		expectTypeOf<
			null extends Row["kids"] ? true : false
		>().toEqualTypeOf<false>();
	});

	it("E4 a nested-read key widens when the ordinary recursive term projects the same key as a nullable json column (#500/R7, review B2)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{
						pid: holder.id,
						kids: jsonArrayFrom(
							select({ id: child.id, name: child.nameReq }, child),
						),
					},
					holder,
				).where(isNull(holder.parent)),
				(self) =>
					select({ pid: holder.id, kids: holder.blob }, self).innerJoin(
						holder,
						eq(self.pid, holder.parent),
					),
			);
			return select({ pid: r.pid, kids: r.kids }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		expectTypeOf<
			null extends Row["kids"] ? true : false
		>().toEqualTypeOf<true>();
	});

	it("E5 a jsonObjectFrom key already reads nullable by its own rule; the widening's union is idempotent there (#500/R7)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{
						pid: holder.id,
						kid: jsonObjectFrom(
							select({ id: child.id, name: child.nameReq }, child),
						),
					},
					holder,
				).where(isNull(holder.parent)),
				(self) =>
					select({ pid: holder.id, kid: holder.blob }, self).innerJoin(
						holder,
						eq(self.pid, holder.parent),
					),
			);
			return select({ pid: r.pid, kid: r.kid }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		// jsonObjectFrom's own rule is already `| null` -- the widening's
		// union with that is idempotent (the null has two reasons here,
		// not two nulls). E4 above is the array-read control on the same
		// shape: the array rule alone is never null, so there the
		// widening is what actually adds it (review E6, the same input
		// class as E4, is not stated a second time).
		expectTypeOf<
			null extends Row["kid"] ? true : false
		>().toEqualTypeOf<true>();
	});

	it("E12 anchor an array read, recursive term an object read for the same key -> outward nullable (#500/R8, the two nested-read kinds meeting across branches)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{
						pid: holder.id,
						k: jsonArrayFrom(
							select({ id: child.id, name: child.nameReq }, child),
						),
					},
					holder,
				).where(isNull(holder.parent)),
				(self) =>
					select(
						{
							pid: holder.id,
							k: jsonObjectFrom(
								select({ id: child.id, name: child.nameReq }, child),
							),
						},
						self,
					).innerJoin(holder, eq(self.pid, holder.parent)),
			);
			return select({ pid: r.pid, k: r.k }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		// the recursive term's own value is an object read, nullable by
		// its own rule (#500/R8) -- the anchor's array-read type still
		// governs the shape, only the object read's nullability widens it.
		expectTypeOf<null extends Row["k"] ? true : false>().toEqualTypeOf<true>();
	});

	it("E7 both branches project the identical nested read: it stays non-null, never falsely widened by the recursive value's own resolution (#500/R7)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{
						pid: holder.id,
						kids: jsonArrayFrom(
							select({ id: child.id, name: child.nameReq }, child),
						),
					},
					holder,
				).where(isNull(holder.parent)),
				(self) =>
					select(
						{
							pid: holder.id,
							kids: jsonArrayFrom(
								select({ id: child.id, name: child.nameReq }, child),
							),
						},
						self,
					).innerJoin(holder, eq(self.pid, holder.parent)),
			);
			return select({ pid: r.pid, kids: r.kids }, r);
		});
		type Row = SelectResult<typeof stage.projectionInput, never>;
		expectTypeOf<
			null extends Row["kids"] ? true : false
		>().toEqualTypeOf<false>();
	});

	it("E11a a non-null anchor value with a jsonArrayFrom recursive value stays non-null (#500/R7, review E8/E11)", () => {
		const arrVal = jsonArrayFrom(
			select({ id: child.id, name: child.nameReq }, child),
		);
		type R = RecursiveCteReference<
			{ readonly k: typeof posts.amountRequired },
			{ readonly k: typeof arrVal },
			never
		>;
		type Row = SelectResult<{ readonly k: R["k"] }, never>;
		expectTypeOf<Row["k"]>().toEqualTypeOf<number>();
	});

	it("E11c control: a non-null anchor value with a non-null recursive column stays non-null (already true before this fix)", () => {
		type R = RecursiveCteReference<
			{ readonly k: typeof posts.amountRequired },
			{ readonly k: typeof posts.titleRequired },
			never
		>;
		type Row = SelectResult<{ readonly k: R["k"] }, never>;
		expectTypeOf<Row["k"]>().toEqualTypeOf<number>();
	});

	it("a recursion-free nested read is unaffected -- jsonArrayFrom non-null, jsonObjectFrom nullable, as always", () => {
		const plain = select(
			{
				id: holder.id,
				kids: jsonArrayFrom(
					select({ id: child.id, name: child.nameReq }, child),
				),
				kid: jsonObjectFrom(
					select({ id: child.id, name: child.nameReq }, child),
				),
			},
			holder,
		);
		type Row = SelectResult<typeof plain.projectionInput, never>;
		expectTypeOf<
			null extends Row["kids"] ? true : false
		>().toEqualTypeOf<false>();
		expectTypeOf<
			null extends Row["kid"] ? true : false
		>().toEqualTypeOf<true>();
	});
});
