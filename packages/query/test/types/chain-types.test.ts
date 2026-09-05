import type {
	DeleteFinal,
	Expr,
	InsertConflictable,
	InsertFinal,
	IntervalValue,
	SelectLimited,
	SelectProjection,
	Table,
	UpdateFinal,
} from "@hejbro/core";
import { bigint, interval, schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { CompileInput } from "../../src/compile/compile";
import type {
	ChainApi,
	DeleteChainFilterable,
	DeleteChainFinal,
	DeleteChainReturnable,
	InsertChainFinal,
	InsertChainReturnable,
	SelectChainDistinctable,
	SelectChainJoinable,
	SelectChainLimited,
	SelectChainRelated,
	SelectChainSetOp,
	SetOpChainBranch,
	UpdateChainFilterable,
	UpdateChainFinal,
	UpdateChainReturnable,
} from "../../src/db/chain";
import { chainProjectionBrand } from "../../src/db/chain-projection";
import type { db, ExecuteResult } from "../../src/db/db";
import type { Tx } from "../../src/db/transaction";
import type { SqlExpr } from "../../src/sql";
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
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	body: text().notNull(),
});

type Comments = typeof comments;

/** A minimal schema module (task 1.3, extend-query-runtime) -- only used to instantiate `db()`'s `TSchema` generic below, never called at runtime. */
const appModule = { posts };

/** A second schema module carrying the `comments` -> `posts` foreign key, so `RelationKeysOf` derives a real relation for the task 3.4 `related()` boundary test below. */
const appModuleWithRelations = { posts, comments };

/**
 * A type-only handle on `ChainApi["select"]`'s own generic signature
 * (narrow-join-nullability, task 3.1) -- never assigned, never called at
 * runtime, the same `declare const` + instantiation-expression technique
 * `txExecute` below already establishes. `SelectRow` extracts the awaited
 * row for a given projection WITHOUT calling `.select()` at runtime (an
 * actual call would need real arguments and a real `dbHandle`, neither of
 * which exist here) -- `typeof chainSelect<TProjection>` is a pure type
 * operation (TS 4.7+ instantiation expression), fully erased.
 */
declare const chainSelect: ChainApi<typeof appModule>["select"];
type SelectRow<TProjection extends SelectProjection> = Awaited<
	ReturnType<typeof chainSelect<TProjection>>
>[number];

/** Same technique, for the `with` and `related()` boundary tests (task 3.4). */
declare const chainWith: ChainApi<typeof appModule>["with"];
type WithRow<TProjection extends SelectProjection> = Awaited<
	ReturnType<typeof chainWith<TProjection>>
>[number];

declare const chainSelectWithRelations: ChainApi<
	typeof appModuleWithRelations
>["select"];
declare const relatedMethod: ReturnType<
	typeof chainSelectWithRelations<Posts>
>["related"];
type RelatedRow<TSpec extends Readonly<Record<string, true>>> = Awaited<
	ReturnType<typeof relatedMethod<TSpec>>
>[number];

/**
 * A type-only handle on the JOINABLE chain stage a two-table projection
 * produces (task 3.2) -- `declare const`, never assigned or called; only
 * ever read through `typeof joinable.leftJoin<TJoined>`/`typeof
 * joinable.innerJoin<TJoined>` instantiation expressions inside a `type`
 * alias below, which erase completely (referencing `joinable` itself
 * outside a type position would throw at runtime, since `declare const`
 * produces no actual binding).
 */
declare const joinable: ReturnType<
	typeof chainSelect<{
		readonly fromPosts: typeof posts.status;
		readonly fromComments: typeof comments.body;
	}>
>;
type LeftJoinedChain<TJoined extends Table> = ReturnType<
	typeof joinable.leftJoin<TJoined>
>;
type InnerJoinedChain<TJoined extends Table> = ReturnType<
	typeof joinable.innerJoin<TJoined>
>;

/**
 * A chain stage typed at the DEFAULT (untracked) `TLeftJoined` -- unlike
 * `joinable` above, which starts at `never` via `chainSelect`'s own
 * inference. `never | TJoined` and a buggy assignment mutant's `TJoined`
 * alone are the SAME type, so `joinable`'s own leftJoin test above cannot
 * tell a union accumulation apart from an assignment one (the exact G1
 * core-level trap, reproduced and confirmed at this layer too before this
 * test was added -- see the group's own completion report). This one
 * starts already-untracked instead, where the two diverge.
 */
declare const untrackedJoinable: SelectChainJoinable<{
	readonly fromPosts: typeof posts.status;
	readonly fromComments: typeof comments.body;
}>;
type UntrackedThenLeftJoined<TJoined extends Table> = ReturnType<
	typeof untrackedJoinable.leftJoin<TJoined>
>;

/** A type-only handle on `Tx["execute"]`'s own generic signature (task 3.1) -- never assigned, never called at runtime, same technique `execute-result-type.test.ts` uses for `Db["execute"]`. */
declare const txExecute: Tx["execute"];
type TxRows<TStatement extends CompileInput> = Awaited<
	ReturnType<typeof txExecute<TStatement>>
>;

/**
 * Every assertion here compares `Awaited<SomeChainType>` against
 * {@link ExecuteResult}`<the equivalent core statement>` — never a parallel
 * type this file computes itself. `SelectChainLimited`/`InsertChainFinal`/
 * `UpdateChainFinal`/`DeleteChainFinal` are the exact declared return types
 * `Db["select"]`/`Db["insert"]`/`Db["update"]`/`Db["deleteFrom"]` resolve
 * through (`db.ts`'s `select: ChainApi["select"]`, … — a direct type
 * alias, not a structurally-similar redefinition), so this reuses the
 * real member end to end.
 *
 * `ExecuteResult` and every `*ChainFinal`/`SelectChainLimited` type both
 * bottom out in the same two building blocks — {@link SelectResult} (task
 * 3.10) and {@link ReturningRow} (task 3.13, itself reusing
 * `SelectResult`) — so this is a **shared-failure** proof, not an
 * import-alone one: breaking either building block's own logic (verified
 * during implementation by temporarily flattening
 * `select-result.ts`'s `IsColumnNotNull` to always `false`) turns every
 * `notNull`-column assertion red in this file *and* in
 * `execute-result-type.test.ts`'s own whole-table assertion together,
 * never just one of the two.
 */
describe("chain await types equal execute types for select and returning mutations (task 7.5)", () => {
	it("a whole-table select chain awaits to exactly what db.execute(select(table)) resolves", () => {
		expectTypeOf<Awaited<SelectChainLimited<Posts>>>().toEqualTypeOf<
			ExecuteResult<SelectLimited<Posts>>
		>();
		// spelled out concretely too (mirrors execute-result-type.test.ts's
		// own belt-and-suspenders check) -- a future SelectResult regression
		// can't hide behind this file only re-testing via ExecuteResult.
		expectTypeOf<Awaited<SelectChainLimited<Posts>>[number]>().toEqualTypeOf<{
			readonly id: string;
			readonly status: string;
			readonly amount: bigint | null;
			readonly duration: IntervalValue | null;
		}>();
	});

	it("an object-projection select chain awaits to exactly what db.execute resolves", () => {
		type Projection = { readonly total: Posts["amount"] };

		expectTypeOf<Awaited<SelectChainLimited<Projection>>>().toEqualTypeOf<
			ExecuteResult<SelectLimited<Projection>>
		>();
	});

	it("insert chain with an explicit .returning(projection) awaits to exactly what db.execute(insert(...).returning(projection)) resolves", () => {
		type Projection = { readonly insertedId: Posts["id"] };

		expectTypeOf<Awaited<InsertChainFinal<Posts, Projection>>>().toEqualTypeOf<
			ExecuteResult<InsertFinal<Posts, Projection>>
		>();
	});

	it("update chain with an explicit .returning(projection) awaits to exactly what db.execute(update(...).returning(projection)) resolves", () => {
		type Projection = { readonly updatedId: Posts["id"] };

		expectTypeOf<Awaited<UpdateChainFinal<Posts, Projection>>>().toEqualTypeOf<
			ExecuteResult<UpdateFinal<Posts, Projection>>
		>();
	});

	it("deleteFrom chain with an explicit .returning(projection) awaits to exactly what db.execute(deleteFrom(...).returning(projection)) resolves", () => {
		type Projection = { readonly deletedId: Posts["id"] };

		expectTypeOf<Awaited<DeleteChainFinal<Posts, Projection>>>().toEqualTypeOf<
			ExecuteResult<DeleteFinal<Posts, Projection>>
		>();
	});

	it("a returning-less mutation chain (no .returning() call at all) awaits to ReadonlyArray<never>, exactly what db.execute(insert(...).values(...)) resolves (#622)", () => {
		// The stage a chain sits at before .returning(): what db.insert(t)
		// .values(r) / db.update(t).set(v) / db.deleteFrom(t) hand back.
		expectTypeOf<Awaited<InsertChainReturnable<Posts>>>().toEqualTypeOf<
			ExecuteResult<InsertConflictable<Posts>>
		>();
		expectTypeOf<Awaited<InsertChainReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		expectTypeOf<Awaited<UpdateChainReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		expectTypeOf<Awaited<DeleteChainReturnable<Posts>>>().toEqualTypeOf<
			ReadonlyArray<never>
		>();
		// The bare terminal name keeps its old meaning: every declared column.
		expectTypeOf<Awaited<InsertChainFinal<Posts>>>().toEqualTypeOf<
			ExecuteResult<InsertFinal<Posts>>
		>();
	});

	it("tx.execute resolves ExecuteResult<TStatement>, exactly like db.execute (task 3.1, #326)", () => {
		// `Tx = ChainApi & { execute<TStatement extends CompileInput>(statement:
		// TStatement): Promise<ExecuteResult<TStatement>> }` (task 3.1): the
		// asymmetry #326 tracked (tx.execute staying the plain DriverRow shape
		// while the same tx's own chain members resolved a richer type) is
		// closed -- tx.execute now resolves the identical declared row type
		// db.execute resolves for the identical statement kind.
		expectTypeOf<TxRows<SelectLimited<Posts>>>().toEqualTypeOf<
			ExecuteResult<SelectLimited<Posts>>
		>();
	});
});

/**
 * #386: a `sql` fragment is `Expr<"unknown">`, so before the `Condition`
 * union reached the chain every one of these positions rejected it — the
 * escape hatch D93 designates as the answer for everything the typed
 * operators cannot express had no way into a condition. These are
 * type-only assertions: the runtime path was always able to carry the
 * fragment, only the parameter types refused it.
 */
describe("db.select's chain threads the left-joined set (narrow-join-nullability, task 3.1)", () => {
	it("db.select(...) starts at never -- a direct notNull column narrows with no join at all", () => {
		type Row = SelectRow<{ readonly t: typeof posts.status }>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});
});

describe("the chain's leftJoin accumulates the joined table, innerJoin does not (narrow-join-nullability, task 3.2)", () => {
	it("after leftJoin(comments), the comments-sourced field is nullable while the posts-sourced field stays narrow", () => {
		type Row = Awaited<LeftJoinedChain<typeof comments>>[number];
		expectTypeOf<Row["fromPosts"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["fromComments"]>().toEqualTypeOf<string | null>();
	});

	it("innerJoin(comments) narrows both -- it never accumulates into the left-joined set", () => {
		type Row = Awaited<InnerJoinedChain<typeof comments>>[number];
		expectTypeOf<Row["fromPosts"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["fromComments"]>().toEqualTypeOf<string>();
	});

	it("a chain stage typed at the untracked default stays untracked after leftJoin (chain-level ratchet)", () => {
		type Row = Awaited<UntrackedThenLeftJoined<typeof comments>>[number];
		expectTypeOf<Row["fromPosts"]>().toEqualTypeOf<string | null>();
	});
});

describe("the untracked boundary holds at db.with and related() (narrow-join-nullability, task 3.4)", () => {
	it("a db.with(...) body's own notNull column stays nullable, even though the callback's own return type has nowhere to carry a left-joined set at all", () => {
		// `ChainApi["with"]`'s callback is declared to return the bare,
		// one-argument `SelectLimited<TProjection> | SetOpStage<TProjection>`
		// (chain.ts) -- a body that calls `.leftJoin(...)` still structurally
		// satisfies that return type (a tracked stage is assignable to the
		// untracked position, the same back-compat direction G1 measured),
		// but the TLeftJoined it accumulated is never captured anywhere in
		// `WithChainTerminal`, which threads only `SelectResult<TProjection>`
		// (one argument) through to the awaited row.
		type Row = WithRow<{ readonly t: Posts["status"] }>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string | null>();
	});

	it("related()'s own SelectResult<TTable> half keeps full per-column richness regardless (whole-table branch never consults TLeftJoined), and the RelatedResult half doesn't leak a narrower merge", () => {
		type Row = RelatedRow<{ readonly comments: true }>;
		// The parent table's own columns: full richness, unaffected by this
		// change (whole-table SelectResult never reads TLeftJoined) --
		// `status` is notNull and narrows regardless.
		expectTypeOf<Row["status"]>().toEqualTypeOf<string>();
		// The merged relation: an array of the related table's own rows,
		// each with full per-column richness too (the related child is read
		// via its own nested select, not through this statement's joins).
		expectTypeOf<Row["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly postId: string;
				readonly body: string;
			}>
		>();
	});
});

/**
 * Type-only handles for task 3.6's set-op and stage-preservation tests
 * (`declare const` is an ambient declaration -- module scope only, never
 * inside a function body, which is why these live here and not inside
 * their own `describe` callbacks).
 */
declare const leftBranchNever: SelectChainLimited<
	{ readonly t: Posts["status"] },
	never
>;
declare const rightBranchTracked: SelectChainLimited<
	{ readonly t: Posts["status"] },
	Posts
>;
type RightRow = Awaited<typeof rightBranchTracked>[number];

/**
 * The mirror placement (reviewer-flagged): the first test below fixes
 * left=never (narrows)/right=Posts (stays nullable) -- a mutant that
 * drops the RIGHT branch's own null is caught there, but a mutant that
 * drops the LEFT branch's own null passes the whole suite undetected
 * unless the placement is also exercised in reverse. Same left-joined
 * values, opposite sides.
 */
declare const leftBranchTracked: SelectChainLimited<
	{ readonly t: Posts["status"] },
	Posts
>;
declare const rightBranchNever: SelectChainLimited<
	{ readonly t: Posts["status"] },
	never
>;
type RightRowNever = Awaited<typeof rightBranchNever>[number];

// Tracked at `Comments`, deliberately NOT `Posts` (the projected field's
// own source table): a member match (tracked = Posts) stays nullable
// either way, indistinguishable from an untracked drop -- the same
// self-match trap task 3.2's own ratchet test exists to avoid. Tracked at
// a table the field does NOT come from, the correct answer is a genuine
// narrow (`string`); a stage that silently drops to untracked would
// wrongly widen back to `string | null`, which IS distinguishable.
declare const tracked: SelectChainDistinctable<
	{ readonly t: Posts["status"] },
	Comments
>;
declare const trackedGrouped: ReturnType<typeof tracked.groupBy>;
type TrackedRow<T extends PromiseLike<ReadonlyArray<unknown>>> =
	Awaited<T>[number];

describe("a set-op combinator's two branches each keep their OWN left-joined set (narrow-join-nullability, task 3.6, reviewer-elevated priority)", () => {
	// The only non-fail-safe direction in this whole change: if one
	// branch's set were applied to the other, a field that should stay
	// nullable could come out non-null. Structurally this cannot happen --
	// `chainSetOpCombinators<TRow>` is parameterized by each branch's own
	// ALREADY-RESOLVED row type (`SelectResult<TProjection, TLeftJoined>`,
	// computed before the combinator runs), and `SetOpResult<TLeft,TRight>`
	// unions the two resolved row types field-by-field -- it is a row-level
	// union, with no path back to either branch's own TLeftJoined to apply
	// to the other. This test locks that observably.
	it("left narrows (never), right stays nullable (posts itself left-joined): union() keeps the field nullable", () => {
		type UnionRow = Awaited<
			ReturnType<typeof leftBranchNever.union<RightRow>>
		>[number];
		expectTypeOf<UnionRow["t"]>().toEqualTypeOf<string | null>();
	});

	it("the mirror placement: left stays nullable (posts itself left-joined), right narrows (never) -- union() still keeps the field nullable", () => {
		type UnionRow = Awaited<
			ReturnType<typeof leftBranchTracked.union<RightRowNever>>
		>[number];
		expectTypeOf<UnionRow["t"]>().toEqualTypeOf<string | null>();
	});
});

describe("every select chain stage transition preserves the left-joined set (narrow-join-nullability, task 3.6)", () => {
	// Each stage member (where/orderBy/groupBy/having/limit/offset/distinct)
	// forwards the SAME TLeftJoined its own factory function received --
	// one assertion per transition, so a future edit that drops it at any
	// single stage has a dedicated catcher (the exact class of gap task
	// 2.6 found: a mutant that breaks only one stage never shows up in a
	// suite that only ever exercises a different one).
	it("distinct() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.distinct>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("where() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.where>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("groupBy() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.groupBy>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("orderBy() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.orderBy>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("having() preserves the set (via groupBy() first, since having() only exists after it)", () => {
		type Row = TrackedRow<ReturnType<typeof trackedGrouped.having>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("limit() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.limit>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});

	it("offset() preserves the set", () => {
		type Row = TrackedRow<ReturnType<typeof tracked.offset>>;
		expectTypeOf<Row["t"]>().toEqualTypeOf<string>();
	});
});

describe("sql fragments are conditions everywhere the chain takes one (#386)", () => {
	it("type-checks in select where, join on, update where and delete where", () => {
		// Assignability, in the direction that matters: a fragment goes INTO
		// each condition parameter. Reverse it and every line passes
		// vacuously. Type-only throughout — `toBeCallableWith` would
		// evaluate its argument at runtime, and there is no fragment to
		// build here.
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<SelectChainJoinable<Posts>["where"]>[0]
		>();
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<SelectChainJoinable<Posts>["innerJoin"]>[1]
		>();
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<SelectChainJoinable<Posts>["leftJoin"]>[1]
		>();
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<UpdateChainFilterable<Posts>["where"]>[0]
		>();
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<DeleteChainFilterable<Posts>["where"]>[0]
		>();
		expectTypeOf<SqlExpr>().toExtend<
			Parameters<SelectChainRelated<{ id: string }>["where"]>[0]
		>();
	});
});

describe("the handle's retained schema keeps the module's own type (task 1.3, extend-query-runtime)", () => {
	it("handle.schema equals the schema module's own type, not a widened record", () => {
		expectTypeOf<
			ReturnType<typeof db<typeof appModule>>["schema"]
		>().toEqualTypeOf<typeof appModule>();
	});
});

// Extracts exactly the branded property, never the whole stage type -- a
// whole-stage comparison passes vacuously regardless of whether the
// carrier actually works (measured trap, select-join-types.test.ts's own
// doc comment for the identical leftJoinedBrand shape).
type ChainProjectionOf<T> = T extends {
	readonly [chainProjectionBrand]?: infer TProjection;
}
	? NonNullable<TProjection>
	: never;

describe("the chain stage carries its own projection as a phantom brand (task 1.2b, 503/R9)", () => {
	it("SelectChainLimited's own brand is exactly its own TProjection", () => {
		expectTypeOf<
			ChainProjectionOf<SelectChainLimited<Posts>>
		>().toEqualTypeOf<Posts>();
	});

	it("a combined SelectChainSetOp stage still carries the left branch's own projection", () => {
		type Row = SelectResult<Posts>;
		expectTypeOf<
			ChainProjectionOf<SelectChainSetOp<Row, Posts>>
		>().toEqualTypeOf<Posts>();
	});
});

// Shared-key branches for the chain surface's own input table (task
// 1.2c): every branch below projects a single key "v", so the pair
// tested is exactly the family of that one key.
declare const textBranch: ReturnType<
	typeof chainSelect<{ readonly v: typeof posts.status }>
>;
declare const otherTextBranch: ReturnType<
	typeof chainSelect<{ readonly v: typeof posts.status }>
>;
declare const numericBranch: ReturnType<
	typeof chainSelect<{ readonly v: typeof posts.amount }>
>;
declare const unknownBranch: ReturnType<
	typeof chainSelect<{ readonly v: Expr<"unknown"> }>
>;
declare const unionFamilyBranch: ReturnType<
	typeof chainSelect<{ readonly v: Expr<"text" | "numeric"> }>
>;
/** A branch carrying no projection at all (R9 decision 4's fail-open shape) -- exactly `related()`'s own `ChainTerminal<TRow>`, never `SelectChainLimited`/`SelectChainSetOp`, so it has no `ChainProjectionBrand` to read. */
declare const brandlessBranch: SetOpChainBranch<{ readonly v: string }>;

describe("the rule on the chain surface (task 1.2c)", () => {
	it("a text branch unioned with a numeric branch under the same key is refused at .union()'s parameter", () => {
		const rejected = () =>
			// @ts-expect-error textBranch's "v" (text) and numericBranch's "v"
			// (numeric) are different families and 1.1 measured this pair
			// refused (42804/42846).
			textBranch.union(numericBranch);
		expectTypeOf(rejected).toBeFunction();
	});

	it("two same-family branches still type-check and the result keeps today's row shape", () => {
		const accepted = () => textBranch.union(otherTextBranch);
		expectTypeOf(accepted).toBeFunction();
		type CombinedRow = Awaited<ReturnType<typeof accepted>>[number];
		expectTypeOf<CombinedRow>().toEqualTypeOf<
			Awaited<typeof textBranch>[number]
		>();
	});

	it('a branch whose key is a sql fragment (family "unknown") matches any family', () => {
		const accepted = () => textBranch.union(unknownBranch);
		expectTypeOf(accepted).toBeFunction();
	});

	it("a union-typed family (not a single literal) is accepted, not distributed over", () => {
		const accepted = () => unionFamilyBranch.union(numericBranch);
		expectTypeOf(accepted).toBeFunction();
	});

	it("a branch that carries no projection is accepted (fail-open, 503/R9 decision 4)", () => {
		const accepted = () => textBranch.union(brandlessBranch);
		expectTypeOf(accepted).toBeFunction();
	});

	it("a combined stage still carries the left branch's own projection into a further combinator", () => {
		const acceptedThenCompatible = () =>
			textBranch.union(otherTextBranch).union(textBranch);
		expectTypeOf(acceptedThenCompatible).toBeFunction();

		const rejectedThenIncompatible = () =>
			textBranch.union(otherTextBranch).union(
				// @ts-expect-error the combined stage still carries the left
				// branch's own projection (text); numericBranch disagrees on
				// the shared key's family (numeric), 1.1 measured refused.
				numericBranch,
			);
		expectTypeOf(rejectedThenIncompatible).toBeFunction();
	});
});
