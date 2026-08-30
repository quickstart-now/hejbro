import type {
	DeleteFinal,
	InsertFinal,
	IntervalValue,
	SelectLimited,
	UpdateFinal,
} from "@hejbro/core";
import { bigint, interval, schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { CompileInput } from "../../src/compile/compile";
import type {
	DeleteChainFilterable,
	DeleteChainFinal,
	InsertChainFinal,
	SelectChainJoinable,
	SelectChainLimited,
	SelectChainRelated,
	UpdateChainFilterable,
	UpdateChainFinal,
} from "../../src/db/chain";
import type { db, ExecuteResult } from "../../src/db/db";
import type { Tx } from "../../src/db/transaction";
import type { SqlExpr } from "../../src/sql";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});

type Posts = typeof posts;

/** A minimal schema module (task 1.3, extend-query-runtime) -- only used to instantiate `db()`'s `TSchema` generic below, never called at runtime. */
const appModule = { posts };

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

	it("a returning-less mutation chain (no .returning() call at all) awaits to exactly what db.execute(insert(...).values(...)) resolves -- the same documented imprecision db.ts's own ExecuteResult already carries, inherited rather than re-decided", () => {
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
