import type {
	DeleteFinal,
	DeleteReturnable,
	InsertConflictable,
	InsertFinal,
	IntervalValue,
	QueryNode,
	SelectLimited,
	SetOpStage,
	UpdateFinal,
	UpdateReturnable,
} from "@hejbro/core";
// biome-ignore lint/style/useImportType: jsonArrayFrom is used only in a type position below via `typeof jsonArrayFrom<T>` (a real instantiation expression), which requires an actual value import -- `import type` has no runtime binding to reference.
import {
	bigint,
	integer,
	interval,
	jsonArrayFrom,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { CompileInput } from "../../src/compile/compile";
import type { ScopedDb } from "../../src/db/context";
import type { Db } from "../../src/db/db";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});

type Posts = typeof posts;

const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	body: text().notNull(),
});

type Comments = typeof comments;

// Fixtures for the flat-shape branch-fold table (widen-set-op-execute,
// task 1.2) -- a declared numeric-mode difference (row 2), a declared
// nullability difference in each direction (rows 3a/3b, #944), and the
// join/no-join pairing over `comments.body` rows 4a/4b/5 reuse.
const numericLeft = table(app, "wso_numeric_left", {
	id: uuid().primaryKey(),
	num: integer().notNull(),
});
type NumericLeft = typeof numericLeft;
const numericRight = table(app, "wso_numeric_right", {
	id: uuid().primaryKey(),
	num: bigint({ mode: "bigint" }).notNull(),
});
type NumericRight = typeof numericRight;

// Whole-table (not object-projection) on purpose, rows 3a/3b: the old
// fallback's blanket object-projection null-widening would otherwise
// make 3b's own row coincidentally match the new fold's answer for the
// wrong reason (always-null, not "read the right branch") -- a
// whole-table branch's `SelectResult` reads its OWN table's declared
// `notNull` regardless of tracking, so only the real fold reads the
// RIGHT branch's own declared nullability, making 3b genuinely red
// against the old, left-only fallback (#944).
const flagTableNotNull = table(app, "wso_flag_table_not_null", {
	id: uuid().primaryKey(),
	flag: text().notNull(),
});
type FlagTableNotNull = typeof flagTableNotNull;
const flagTableNullable = table(app, "wso_flag_table_nullable", {
	id: uuid().primaryKey(),
	flag: text(),
});
type FlagTableNullable = typeof flagTableNullable;

/**
 * A type-only handle on `Db["execute"]`'s own generic signature -- never
 * assigned, never called at runtime (only ever used inside `typeof
 * dbExecute<...>`, itself only ever used in a type position below, so
 * this `declare const` is fully erased and touches nothing at runtime).
 */
declare const dbExecute: Db["execute"];

/**
 * Instantiates `Db["execute"]`'s own generic signature against a specific
 * `TStatement` (a real TS 4.7+ instantiation expression, not a
 * conditional-type approximation of one) and extracts the resolved row
 * type -- tests the real member end to end, not a parallel utility that
 * could drift from it.
 */
type ExecuteRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof dbExecute<TStatement>>
>;

/**
 * A type-only handle on `Db["select"]`'s own chain member (widen-set-
 * op-execute, task 1.2, row 7) -- the same instantiation-expression
 * technique as {@link dbExecute}, chained: `typeof dbSelect<P>` fixes the
 * projection, `.union<TOther, TOtherProjection>` on the resulting type
 * fixes the other branch's own resolved row without ever constructing a
 * real value (nothing here is called at runtime; `declare` only works at
 * module scope, not inside a test body, hence hoisted here).
 */
declare const dbSelect: Db["select"];
declare const chainLeftPosts: ReturnType<typeof dbSelect<Posts>>;
declare const chainRightPosts: ReturnType<typeof dbSelect<Posts>>;

describe("Db.execute's resolved row type (task 4.11)", () => {
	it("a whole-table select resolves the declared column types exactly (bigint mode, IntervalValue, notNull) -- exact match, not loose", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		// spelled out concretely too, so a future SelectResult regression
		// can't hide behind this file only re-testing via SelectResult itself.
		expectTypeOf<ExecuteRows<Stage>[number]>().toEqualTypeOf<{
			readonly id: string;
			readonly status: string;
			readonly amount: bigint | null;
			readonly duration: IntervalValue | null;
		}>();
	});

	it("an object projection resolves exactly those keys -- no more, no less", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;
		type Row = ExecuteRows<Stage>[number];

		// #311: a projected declared column keeps its declared type (mode
		// 'bigint' here), not the family-wide union. Nullability still
		// widens here -- #307 is landed (narrow-join-nullability), but only
		// when ExecuteResult can see the set: this `Stage` uses the bare,
		// one-argument `SelectLimited`/`InsertFinal` form, so `TLeftJoined`
		// defaults to untracked and stays widened on purpose (the same
		// fail-safe default `SelectResult`'s own task 2.4 pins).
		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | null;
		}>();
		// @ts-expect-error "status" was never projected -- not a key of Row.
		type _Rejected = Row["status"];
	});

	it("a bare (already-unwrapped) QueryNode keeps the plain DriverRow shape -- select's richness only exists at the builder-stage level, doesn't leak past compile()", () => {
		expectTypeOf<ExecuteRows<QueryNode>>().toEqualTypeOf<
			ReadonlyArray<Readonly<Record<string, unknown>>>
		>();
	});
});

describe("Db.execute's resolved row type for a core-built set operation (task 3.1, #551)", () => {
	it("a whole-table union reads back as the left branch's declared row shape, not a raw driver row", () => {
		type Stage = SetOpStage<Posts>;
		type BranchAlone = SelectLimited<Posts>;

		// Independent oracle (review repair, task 5.2): the type the same
		// handle resolves executing the left branch alone -- not
		// `ReadonlyArray<SelectResult<Posts>>`, the exact expression
		// ExecuteResult itself evaluates for this branch, which would hold
		// tautologically however that expression resolved.
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ExecuteRows<BranchAlone>
		>();
	});

	it("an object-projection union reads back as the left branch's declared keys and types, widened with null where the join record is missing -- no more, no less", () => {
		// posts.status is declared notNull (review repair, task 5.2) --
		// the original fixture here projected posts.amount, already
		// nullable, so the widening this scenario promises was invisible:
		// `bigint | null` looks identical whether or not it widened.
		type Projection = { readonly label: Posts["status"] };
		type Stage = SetOpStage<Projection>;
		type BranchAlone = SelectLimited<Projection>;
		type Row = ExecuteRows<Stage>[number];

		// Unlike the whole-table oracle above, this one is not fully
		// independent: a real (value-level) execute() of BranchAlone would
		// infer `{ label: string }`, not `| null` -- this bare, type-only
		// SelectLimited<Projection> defaults TLeftJoined to UntrackedJoins,
		// the same default ExecuteResult's SetOpStage branch takes, so both
		// sides pass through the same widening. The literal pin right below
		// is the genuinely independent check for the widening itself.
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ExecuteRows<BranchAlone>
		>();
		expectTypeOf<Row>().toEqualTypeOf<{ readonly label: string | null }>();
		// @ts-expect-error "id" was never projected -- not a key of Row.
		type _Rejected = Row["id"];
	});

	it("a set-op stage further chained with orderBy()/limit() keeps the same resolved row type -- neither changes TProjection", () => {
		type OrderedStage = ReturnType<SetOpStage<Posts>["orderBy"]>;
		type LimitedStage = ReturnType<SetOpStage<Posts>["limit"]>;

		expectTypeOf<ExecuteRows<OrderedStage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		expectTypeOf<ExecuteRows<LimitedStage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	// Controls, mirroring this file's own existing cases above -- not new
	// claims, proof that touching db.ts's ExecuteResult for the SetOpStage
	// branch left these two dispatch arms exactly where they were.
	it("an already-unwrapped node stays the plain DriverRow shape -- unaffected by the new branch", () => {
		expectTypeOf<ExecuteRows<QueryNode>>().toEqualTypeOf<
			ReadonlyArray<Readonly<Record<string, unknown>>>
		>();
	});

	it("a mutation chain still resolves through ReturningRow -- never mistaken for a SetOpStage", () => {
		type Stage = InsertFinal<Posts>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});
});

/**
 * The flat-shape branch-fold table (widen-set-op-execute, task 1.2):
 * `ExecuteResult`'s `SetOpStage` arm now carries both branches' own stage
 * types (task 1.1), so a core-built set operation resolves each branch's
 * OWN row through {@link SelectResult} -- its own left-joined tracking
 * included -- before folding the two through `SetOpResult`, the same
 * fold `@hejbro/query`'s chain surface already applies to its own two
 * RESOLVED row types. Nested branches and the six combinators are task
 * 1.3's own table (every cell below builds a `SetOpStage<P, L, R>`
 * directly, by hand -- which of the six runtime combinators would have
 * produced that exact type is not this table's own question, task 1.1's
 * type test already covers it).
 */
describe("ExecuteResult folds both branches for a core-built set operation, flat shapes (widen-set-op-execute, task 1.2)", () => {
	it("1: whole-table both sides, identically declared -- the row is unchanged", () => {
		type LeftBranch = SelectLimited<Posts, never>;
		type RightBranch = SelectLimited<Posts, never>;
		type Stage = SetOpStage<Posts, LeftBranch, RightBranch>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		expectTypeOf<ExecuteRows<Stage>[number]>().toEqualTypeOf<{
			readonly id: string;
			readonly status: string;
			readonly amount: bigint | null;
			readonly duration: IntervalValue | null;
		}>();
	});

	it("2: an object projection with one column declared differently per side (numeric mode) -- the union of both declared read types", () => {
		type LeftProjection = { readonly num: NumericLeft["num"] };
		type RightProjection = { readonly num: NumericRight["num"] };
		type LeftBranch = SelectLimited<LeftProjection, never>;
		type RightBranch = SelectLimited<RightProjection, never>;
		type Stage = SetOpStage<LeftProjection, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly num: number | bigint }>();
	});

	it("3a: a nullable LEFT column against a notNull RIGHT one -- nullable", () => {
		type LeftBranch = SelectLimited<FlagTableNullable, never>;
		type RightBranch = SelectLimited<FlagTableNotNull, never>;
		type Stage = SetOpStage<FlagTableNullable, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly id: string;
			readonly flag: string | null;
		}>();
	});

	it("3b: a notNull LEFT column against a nullable RIGHT one -- nullable too (#944: the fold must read the right branch's own declared type, not only the left's -- whole-table on purpose, see the fixture's own comment)", () => {
		type LeftBranch = SelectLimited<FlagTableNotNull, never>;
		type RightBranch = SelectLimited<FlagTableNullable, never>;
		type Stage = SetOpStage<FlagTableNotNull, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly id: string;
			readonly flag: string | null;
		}>();
	});

	it("4a: LEFT left-joins the projected table, RIGHT inner-joins it -- nullable", () => {
		type Projection = { readonly body: Comments["body"] };
		type LeftBranch = SelectLimited<Projection, Comments>;
		type RightBranch = SelectLimited<Projection, never>;
		type Stage = SetOpStage<Projection, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string | null }>();
	});

	it("4b: LEFT inner-joins the projected table, RIGHT left-joins it -- nullable too, never the reverse", () => {
		type Projection = { readonly body: Comments["body"] };
		type LeftBranch = SelectLimited<Projection, never>;
		type RightBranch = SelectLimited<Projection, Comments>;
		type Stage = SetOpStage<Projection, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string | null }>();
	});

	it("5: neither branch joins anything -- a notNull object-projection column is NOT widened to null (the core-built carve-out's exact defect)", () => {
		type Projection = { readonly body: Comments["body"] };
		type LeftBranch = SelectLimited<Projection, never>;
		type RightBranch = SelectLimited<Projection, never>;
		type Stage = SetOpStage<Projection, LeftBranch, RightBranch>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string }>();
	});

	// 6: a hand-annotated SetOpStage<P> (today's fallback) is already
	// covered above ("task 3.1, #551" and "task 4.2, review repair") and
	// below ("db.execute infers the left-joined set…") -- unchanged, not
	// re-asserted here.

	it("7: the same two branches combined through the chain surface resolve the identical row type (delta scenario: 'the same row the chain surface reads back for the same two branches')", () => {
		type CoreStage = SetOpStage<
			Posts,
			SelectLimited<Posts, never>,
			SelectLimited<Posts, never>
		>;

		type ChainOtherRow = Awaited<typeof chainRightPosts>[number];
		type ChainCombined = ReturnType<
			typeof chainLeftPosts.union<ChainOtherRow, Posts>
		>;

		expectTypeOf<ExecuteRows<CoreStage>>().toEqualTypeOf<
			Awaited<ChainCombined>
		>();
	});
});

/**
 * Nesting and every combinator (widen-set-op-execute, task 1.3): before
 * this task, `SetOpBranchRow` only matches `SelectLimited`, so a branch
 * that is itself a nested `SetOpStage` (`(a union b) except c`, either
 * side) collapses to `never` -- worse than the pre-1.1 fallback, which
 * at least returned the left branch's own projection. The six-combinator
 * cases below are a guard, not new coverage (core's own six combinators
 * all return the identical `SetOpStage<P, this, TOther>` shape, task
 * 1.1 -- `ExecuteResult` has no way to special-case one by name, and
 * must not grow one): a future change that special-cased, say, `union`
 * alone would redden exactly these. The nested cases cross the join and
 * declared-nullability axes so a widening that happens INSIDE the inner
 * stage is provably still visible from the OUTER fold, not just present
 * at the inner level alone.
 */
describe("ExecuteResult folds nested branches and every combinator (widen-set-op-execute, task 1.3)", () => {
	type FlatLeft = SelectLimited<Posts, never>;
	type FlatRight = SelectLimited<Posts, never>;

	it("union: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("unionAll: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("intersect: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("intersectAll: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("except: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("exceptAll: flat resolves through SelectResult, not never", () => {
		type Stage = SetOpStage<Posts, FlatLeft, FlatRight>;
		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("left-nested, pair 1 (union then except), crossed with the join axis: the inner stage's own left-joined nullability survives into the outer fold", () => {
		type Projection = { readonly body: Comments["body"] };
		// Inner: one branch left-joins comments (nullable), the other never
		// joins it (non-null) -- 1.2's own row 4a, nested here instead of
		// asserted directly.
		type LeftJoinedBranch = SelectLimited<Projection, Comments>;
		type UnjoinedBranch = SelectLimited<Projection, never>;
		type Inner = SetOpStage<Projection, LeftJoinedBranch, UnjoinedBranch>;
		// Outer: the inner (nullable) stage as the LEFT branch, a third,
		// unjoined branch on the right -- (a union b) except c's own shape.
		type Outer = SetOpStage<Projection, Inner, UnjoinedBranch>;
		type Row = ExecuteRows<Outer>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string | null }>();
	});

	it("left-nested, pair 2 (intersect then unionAll), same crossing -- a different combinator pair building the identical SetOpStage<P, L, R> shape", () => {
		type Projection = { readonly body: Comments["body"] };
		type LeftJoinedBranch = SelectLimited<Projection, Comments>;
		type UnjoinedBranch = SelectLimited<Projection, never>;
		type Inner = SetOpStage<Projection, LeftJoinedBranch, UnjoinedBranch>;
		type Outer = SetOpStage<Projection, Inner, UnjoinedBranch>;
		type Row = ExecuteRows<Outer>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string | null }>();
	});

	it("right-nested, pair 1 (a except (b union c)), crossed with the declared-nullability axis (#944's own shape, nested): the inner fold's already-widened column survives into the outer fold", () => {
		// Inner (b union c): notNull against nullable -- 1.2's own row 3b,
		// nested here as the RIGHT branch instead of asserted directly.
		type InnerLeft = SelectLimited<FlagTableNotNull, never>;
		type InnerRight = SelectLimited<FlagTableNullable, never>;
		type Inner = SetOpStage<FlagTableNotNull, InnerLeft, InnerRight>;
		// Outer (a except inner): the LEFT branch (`a`) is plain notNull;
		// the RIGHT branch is the already-nullable inner stage.
		type OuterLeft = SelectLimited<FlagTableNotNull, never>;
		type Outer = SetOpStage<FlagTableNotNull, OuterLeft, Inner>;
		type Row = ExecuteRows<Outer>[number];

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly id: string;
			readonly flag: string | null;
		}>();
	});

	it("right-nested, pair 2 (a intersectAll (b exceptAll c)), same crossing -- a different combinator pair", () => {
		type InnerLeft = SelectLimited<FlagTableNotNull, never>;
		type InnerRight = SelectLimited<FlagTableNullable, never>;
		type Inner = SetOpStage<FlagTableNotNull, InnerLeft, InnerRight>;
		type OuterLeft = SelectLimited<FlagTableNotNull, never>;
		type Outer = SetOpStage<FlagTableNotNull, OuterLeft, Inner>;
		type Row = ExecuteRows<Outer>[number];

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly id: string;
			readonly flag: string | null;
		}>();
	});

	it("three levels (((a union b) except c) intersect d), crossed with the join axis throughout -- depth is bounded by the statement, not a type budget (design.md Q3)", () => {
		type Projection = { readonly body: Comments["body"] };
		type LeftJoinedBranch = SelectLimited<Projection, Comments>;
		type UnjoinedBranch = SelectLimited<Projection, never>;
		type Level1 = SetOpStage<Projection, LeftJoinedBranch, UnjoinedBranch>;
		type Level2 = SetOpStage<Projection, Level1, UnjoinedBranch>;
		type Level3 = SetOpStage<Projection, Level2, UnjoinedBranch>;
		type Row = ExecuteRows<Level3>[number];

		expectTypeOf<Row>().toEqualTypeOf<{ readonly body: string | null }>();
	});
});

describe("the two corrected set-operation scenarios get their own observers (task 4.2, review repair)", () => {
	// No red is available here -- ExecuteResult already resolves both
	// forms via SelectResult<TProjection> (task 3.1); this pins the
	// corrected delta sentences directly, spelled out concretely rather
	// than through SelectResult, so a regression in SelectResult itself
	// doesn't silently move both the production code and this pin
	// together. The discriminating check is the mutant tasks.md names:
	// switching ExecuteResult's SetOpStage branch to
	// `SelectResult<TProjection, never>` must fail the object-projection
	// pin below while leaving the whole-table pin green, since the
	// whole-table branch of SelectResult never reads its second type
	// argument at all (resolved from the table's own declaration) and
	// the object-projection branch does (NestedOrExprResult widens with
	// null only for the untracked/UntrackedJoins default, never for
	// `never`, the fully-tracked-empty reading).
	it("the whole-table form reads back identical to the same branch read alone (Scenario: A core-built set operation executed on a handle reads back as its left branch)", () => {
		type Stage = SetOpStage<Posts>;
		type BranchAlone = SelectLimited<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ExecuteRows<BranchAlone>
		>();
		expectTypeOf<ExecuteRows<Stage>[number]>().toEqualTypeOf<{
			readonly id: string;
			readonly status: string;
			readonly amount: bigint | null;
			readonly duration: IntervalValue | null;
		}>();
	});

	it("the object-projection form widens the left branch's declared-notNull key with null, where the join record is missing (Scenario: An object projection widens where the join record is missing)", () => {
		// posts.status is declared notNull -- chosen deliberately (unlike
		// this file's other object-projection fixtures, which use the
		// already-nullable posts.amount) so the widening this scenario
		// promises is the reason this type differs from `string`, not an
		// accident of an already-nullable column.
		type Projection = { readonly label: Posts["status"] };
		type Stage = SetOpStage<Projection>;

		expectTypeOf<ExecuteRows<Stage>[number]>().toEqualTypeOf<{
			readonly label: string | null;
		}>();
	});
});

describe("db.execute infers the left-joined set from the core stage (narrow-join-nullability, task 3.3)", () => {
	it("no leftJoin at all (never): a notNull projected column narrows to non-null", () => {
		type Stage = SelectLimited<{ readonly t: Posts["status"] }, never>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("the projected column's own table is left-joined: the field stays nullable", () => {
		type Stage = SelectLimited<{ readonly t: Posts["status"] }, Posts>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["t"]>().toEqualTypeOf<string | null>();
	});
});

describe("the untracked boundary holds at a nested read's own subselect (narrow-join-nullability, task 3.4)", () => {
	it("the SAME object-projection field (`{ b: Comments['body'] }`) narrows to non-null at top level, but stays nullable once nested -- the top-level half of the contrast below", () => {
		// Same outer set (never) and same projected field as the nested
		// case right below -- the only difference is "nested or not", so
		// this pins the top-level half of the THEN that test's own comment
		// describes, for the identical projection.
		type Stage = SelectLimited<{ readonly b: Comments["body"] }, never>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["b"]>().toEqualTypeOf<string>();
	});

	it("a nested jsonArrayFrom's own object-projection field stays nullable even though the OUTER statement's left-joined set is the fully-tracked empty set (never) -- if the outer set leaked in, this would WRONGLY narrow", () => {
		// NestedOrExprResult (select-result.ts) recurses into SelectResult<TSub>
		// with no second argument at all -- structurally incapable of
		// consulting the outer TLeftJoined, not merely defaulted to it.
		// `never` (nothing left-joined at the outer level) is deliberate: a
		// leak here would read as "tracked, comments is not a member" and
		// WRONGLY narrow `b` to `string` -- the outer set must never reach
		// this position at all, tracked-empty or not.
		type NestedProjection = { readonly b: Comments["body"] };
		type Stage = SelectLimited<
			{
				readonly nested: ReturnType<typeof jsonArrayFrom<NestedProjection>>;
			},
			never
		>;
		type Row = ExecuteRows<Stage>[number];
		expectTypeOf<Row["nested"][number]["b"]>().toEqualTypeOf<string | null>();
	});
});

describe("Db.execute's resolved row type for mutations (task 4.11-mutation)", () => {
	it("insert().returning() (no projection) resolves the whole declared table's shape", () => {
		type Stage = InsertFinal<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	// #622: the stage a chain sits at before returning() is called (what
	// insert().values() actually returns) is the `never` instantiation --
	// the statement carries no RETURNING clause, so the resolved type is
	// the empty array's own, not the table's rows. The bare InsertFinal<T>
	// above keeps meaning every column, exactly as before.
	it("an insert that never called returning() resolves ReadonlyArray<never>", () => {
		type Stage = InsertConflictable<Posts>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<ReadonlyArray<never>>();
		expectTypeOf<Row>().toBeNever();
		// @ts-expect-error nothing is assignable to the element type -- there are no rows.
		const _row: Row = { status: "draft" };
	});

	it("insert().returning({...}) (object projection) resolves exactly those keys -- a different instantiation from the whole-table case, not the same erased shape", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;
		type Row = ExecuteRows<Stage>[number];

		// #311: a projected declared column keeps its declared type (mode
		// 'bigint' here), not the family-wide union. Nullability still
		// widens here -- #307 is landed (narrow-join-nullability), but only
		// when ExecuteResult can see the set: this `Stage` uses the bare,
		// one-argument `SelectLimited`/`InsertFinal` form, so `TLeftJoined`
		// defaults to untracked and stays widened on purpose (the same
		// fail-safe default `SelectResult`'s own task 2.4 pins).
		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | null;
		}>();
		// @ts-expect-error "status" was never projected -- not a key of Row.
		type _Rejected = Row["status"];
	});

	it("update()/deleteFrom() resolve through the exact same ReturningRow mechanism -- one shared path, not three independently-typed copies", () => {
		type UpdateStage = UpdateFinal<Posts>;
		type DeleteStage = DeleteFinal<Posts, { readonly id: Posts["id"] }>;

		expectTypeOf<ExecuteRows<UpdateStage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
		// #622: the never-requested case rides the same path for all three.
		expectTypeOf<ExecuteRows<UpdateReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		expectTypeOf<ExecuteRows<DeleteReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		// A mutation's own left-joined set is always `never` (narrow-join-
		// nullability, task 3.5): ReturningRow's object-projection branch
		// fixes it there rather than taking the one-argument (untracked)
		// form, since a mutation has no join grammar to carry an unknown
		// set at all. `posts.id` (declared primaryKey/notNull) narrows to
		// non-null here -- this assertion changing from `string | null` is
		// this task's own point, not a regression (confirmed red before
		// this fix landed, with that exact `string | null` on the left).
		expectTypeOf<ExecuteRows<DeleteStage>[number]>().toEqualTypeOf<{
			readonly id: string;
		}>();
	});
});

/**
 * Extracts the `tx` type a `transaction()`-shaped member's own callback
 * receives -- generic over *which* member (`Db["transaction"]` vs.
 * `ScopedDb["transaction"]`), so the same helper drives both creation
 * sites below from each site's own real, public signature. Deliberately
 * never compares against the `Tx` alias directly: that would only prove
 * both sites produce *something typed `Tx`*, not that `tx.execute` itself
 * resolves statements the way `db.execute` does -- the per-statement
 * `ExecuteRows<S>` comparisons below are the real proof.
 *
 * A plain `infer`-conditional, not `Parameters<Parameters<T>[0]>[0]`:
 * `Parameters<T>`'s own ambient constraint is `T extends (...args: any) =>
 * any`, which would force this house-rule-`any`-free file to spell `any`
 * itself just to satisfy it. This shape mirrors `Db["transaction"]`/
 * `ScopedDb["transaction"]`'s own real signature
 * (`<T>(callback: (tx) => Promise<T>) => Promise<T>`) exactly, without it.
 */
type TxOf<TTransaction> = TTransaction extends (
	callback: (tx: infer TTx) => Promise<unknown>,
) => Promise<unknown>
	? TTx
	: never;

/**
 * A type-only handle on the unscoped creation site's own `tx.execute`
 * (`createTransactionApi`/`buildTx`, `transaction.ts`) -- same
 * instantiation-expression technique as {@link dbExecute} above.
 */
declare const unscopedTxExecute: TxOf<Db["transaction"]>["execute"];
type UnscopedTxRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof unscopedTxExecute<TStatement>>
>;

/**
 * A type-only handle on the scoped creation site's own `tx.execute`
 * (`scopedTransaction`/`buildTx`, `context.ts`).
 */
declare const scopedTxExecute: TxOf<ScopedDb["transaction"]>["execute"];
type ScopedTxRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof scopedTxExecute<TStatement>>
>;

describe("tx.execute resolves the same types db.execute resolves, at both creation sites (task 3.1, #326)", () => {
	it("unscoped db.transaction's tx.execute: a whole-table select resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("unscoped db.transaction's tx.execute: an object projection resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("unscoped db.transaction's tx.execute: insert().returning(projection) resolves exactly what db.execute resolves", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;

		expectTypeOf<UnscopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("unscoped db.transaction's tx.execute: a bare QueryNode keeps the plain DriverRow shape, same as db.execute", () => {
		expectTypeOf<UnscopedTxRows<QueryNode>>().toEqualTypeOf<
			ExecuteRows<QueryNode>
		>();
	});

	it("scoped db.as(context).transaction's tx.execute: a whole-table select resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<Posts>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("scoped db.as(context).transaction's tx.execute: an object projection resolves exactly what db.execute resolves", () => {
		type Stage = SelectLimited<{ readonly total: Posts["amount"] }>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("scoped db.as(context).transaction's tx.execute: insert().returning(projection) resolves exactly what db.execute resolves", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;

		expectTypeOf<ScopedTxRows<Stage>>().toEqualTypeOf<ExecuteRows<Stage>>();
	});

	it("scoped db.as(context).transaction's tx.execute: a bare QueryNode keeps the plain DriverRow shape, same as db.execute", () => {
		expectTypeOf<ScopedTxRows<QueryNode>>().toEqualTypeOf<
			ExecuteRows<QueryNode>
		>();
	});
});
