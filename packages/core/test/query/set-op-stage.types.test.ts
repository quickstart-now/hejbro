import { describe, expect, expectTypeOf, it } from "vitest";
import type { SetOpStage } from "../../src/index";
import { schema, select, table, text, uuid } from "../../src/index";

const app = schema("app");
const posts = table(app, "set_op_stage_posts", {
	id: uuid().primaryKey(),
	title: text(),
});
const archivedPosts = table(app, "set_op_stage_archived_posts", {
	id: uuid().primaryKey(),
	title: text(),
});
const deletedPosts = table(app, "set_op_stage_deleted_posts", {
	id: uuid().primaryKey(),
	title: text(),
});
const purgedPosts = table(app, "set_op_stage_purged_posts", {
	id: uuid().primaryKey(),
	title: text(),
});
const mismatchedRows = table(app, "set_op_stage_mismatched_rows", {
	id: uuid().primaryKey(),
	name: text(),
});

/**
 * Extracts a `SetOpStage`'s own left/right branch STAGE type, `never` for
 * anything else — the same `infer`-against-a-known-alias pattern
 * `select-join-types.test.ts`'s own `LeftJoinedOf` uses for a different
 * phantom, needed for the identical reason its own doc comment states: a
 * whole-stage `toEqualTypeOf` cannot tell a working carrier from one that
 * silently stayed `unknown` (both sides of that comparison would still be
 * built from the same `SetOpStage` alias either way), while extracting the
 * parameter directly surfaces `unknown` as a concrete, wrong answer on the
 * paths below where the working answer is a real branch stage.
 */
type LeftStageOf<T> =
	T extends SetOpStage<infer _P, infer TLeft, infer _R> ? TLeft : never;
type RightStageOf<T> =
	T extends SetOpStage<infer _P, infer _L, infer TRight> ? TRight : never;

describe("SetOpStage carries both branches' own stage types, every combinator alike (task 1.1, design.md Q1)", () => {
	const left = select(posts);
	const right = select(archivedPosts);

	it("union", () => {
		const combined = left.union(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});

	it("unionAll", () => {
		const combined = left.unionAll(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});

	it("intersect", () => {
		const combined = left.intersect(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});

	it("intersectAll", () => {
		const combined = left.intersectAll(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});

	it("except", () => {
		const combined = left.except(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});

	it("exceptAll", () => {
		const combined = left.exceptAll(right);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof right>();
	});
});

describe("the branch-stage carrier recurses through nested combinations (task 1.1, design.md Q3), spot-checked across different combinators, not only union", () => {
	it("setOp ∪ select: (a union b).except(c) carries the inner combined stage as its own left", () => {
		const ab = select(posts).union(select(archivedPosts));
		const c = select(deletedPosts);
		const combined = ab.except(c);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof ab>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof c>();
	});

	it("setOp ∪ select, a second combinator: (a intersect b).unionAll(c)", () => {
		const ab = select(posts).intersect(select(archivedPosts));
		const c = select(deletedPosts);
		const combined = ab.unionAll(c);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof ab>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof c>();
	});

	it("select ∪ setOp: a.except(b.union(c)) carries the inner combined stage as its own right", () => {
		const a = select(posts);
		const bc = select(archivedPosts).union(select(deletedPosts));
		const combined = a.except(bc);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof a>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof bc>();
	});

	it("select ∪ setOp, a second combinator: a.intersectAll(b.exceptAll(c))", () => {
		const a = select(posts);
		const bc = select(archivedPosts).exceptAll(select(deletedPosts));
		const combined = a.intersectAll(bc);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof a>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof bc>();
	});

	it("three levels: ((a union b) except c) intersect d recurses two branches deep on the left", () => {
		const ab = select(posts).union(select(archivedPosts));
		const abc = ab.except(select(deletedPosts));
		const d = select(purgedPosts);
		const combined = abc.intersect(d);
		expectTypeOf<LeftStageOf<typeof combined>>().toEqualTypeOf<typeof abc>();
		expectTypeOf<RightStageOf<typeof combined>>().toEqualTypeOf<typeof d>();
		// The recursion does not stop after one level: `abc`'s own left is
		// `ab`, not `unknown` — depth is bounded by the statement, never by a
		// fixed type budget (design.md Q3).
		expectTypeOf<LeftStageOf<LeftStageOf<typeof combined>>>().toEqualTypeOf<
			typeof ab
		>();
	});
});

describe("orderBy()/limit() forward both branch parameters unchanged (rework R2: task 1.1 and the proposal both state whole-set orderBy/limit forward both branches -- no cell anywhere pinned it before this; the reviewer's own such cell was measured vacuous, so this one is written fresh, not ported)", () => {
	const left = select(posts);
	const right = select(archivedPosts);
	const combined = left.union(right);

	it("orderBy() keeps the exact same LeftStageOf/RightStageOf", () => {
		const ordered = combined.orderBy(posts.title);
		expectTypeOf<LeftStageOf<typeof ordered>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof ordered>>().toEqualTypeOf<
			typeof right
		>();
	});

	it("limit() keeps the exact same LeftStageOf/RightStageOf", () => {
		const limited = combined.limit(10);
		expectTypeOf<LeftStageOf<typeof limited>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof limited>>().toEqualTypeOf<
			typeof right
		>();
	});

	it("orderBy() then limit(), chained: both still carried", () => {
		const both = combined.orderBy(posts.title).limit(10);
		expectTypeOf<LeftStageOf<typeof both>>().toEqualTypeOf<typeof left>();
		expectTypeOf<RightStageOf<typeof both>>().toEqualTypeOf<typeof right>();
	});
});

describe("compatibility (task 1.1, design.md Q2)", () => {
	it("a one-argument SetOpStage<P> still assigns from a fully-branched combination", () => {
		const combined = select(posts).union(select(archivedPosts));
		const widened: SetOpStage<typeof posts> = combined;
		expectTypeOf(widened).toEqualTypeOf<SetOpStage<typeof posts>>();
	});

	it("a hand-annotated SetOpStage<P> parameter still accepts a fully-branched combination", () => {
		const accept = (_stage: SetOpStage<typeof posts>): void => undefined;
		accept(select(posts).union(select(archivedPosts)));
	});
});

describe("a mismatched key set still fails (task 1.1, unchanged from #487)", () => {
	it("a select over {id, name} unioned with a select over {id, title} does not compile -- wrapped in toThrow() since #487's own runtime guard (assertSameSetOpKeyOrder) also refuses this key-set mismatch once @ts-expect-error lets the JS run (select.test.ts's own precedent, line 886)", () => {
		expect(() =>
			select(
				{ id: mismatchedRows.id, name: mismatchedRows.name },
				mismatchedRows,
			).union(
				// @ts-expect-error mismatchedRows projects {id, name}; posts
				// projects {id, title} -- the key sets differ, so SetOpResult
				// resolves to never and poisons this parameter exactly as
				// before the branch-stage carrier was added (#487, unchanged).
				select(posts),
			),
		).toThrow(expect.objectContaining({ code: "set-op-key-set-mismatch" }));
	});
});

describe("the compatibility gate survives the signature rewrite, all four positions (rework R3, source: reviewer's FINAL-zz-reviewer-query.test.ts, describe 'reviewer: the compatibility gate survives the signature rewrite (#487's own gap)' -- ported verbatim, only the local fixture names changed (posts/archivedPosts/mismatchedRows for the reviewer's la/rb/mm): task 1.1 rewrote the combinator signature so TOther is the OTHER branch's whole stage, not its bare projection, and #487 is on record as the bug where the CHAINED position kept the gap after the first was fixed -- so all four positions are pinned, not just the first. None of these run: the runtime guard would throw first, unreached, matching the block above.", () => {
	it("refuses a mismatched branch in the FIRST position", () => {
		const unreached = () =>
			// @ts-expect-error posts projects {id, title}; mismatchedRows projects {id, name}
			select(posts).union(select(mismatchedRows));
		expectTypeOf(unreached).not.toBeNever();
	});
	it("refuses a mismatched branch in the CHAINED position", () => {
		const unreached = () =>
			// @ts-expect-error the third branch is checked exactly like the second
			select(posts).union(select(archivedPosts)).except(select(mismatchedRows));
		expectTypeOf(unreached).not.toBeNever();
	});
	it("refuses a mismatched branch nested on the RIGHT", () => {
		const unreached = () =>
			// @ts-expect-error the inner combination itself is incompatible
			select(posts).except(select(archivedPosts).union(select(mismatchedRows)));
		expectTypeOf(unreached).not.toBeNever();
	});
	it("refuses when the LEFT side is the odd one out", () => {
		const unreached = () =>
			// @ts-expect-error reversed direction, same refusal
			select(mismatchedRows).union(select(posts));
		expectTypeOf(unreached).not.toBeNever();
	});
});
