import type {
	DeleteFinal,
	InsertFinal,
	IntervalValue,
	SelectLimited,
	UpdateFinal,
} from "@hejbro/core";
import { bigint, interval, schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type {
	DeleteChainFinal,
	InsertChainFinal,
	SelectChainLimited,
	UpdateChainFinal,
} from "../../src/db/chain";
import type { ExecuteResult } from "../../src/db/db";
import type { Tx } from "../../src/db/transaction";
import type { DriverRow } from "../../src/driver/contract";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	amount: bigint({ mode: "bigint" }),
	duration: interval(),
});

type Posts = typeof posts;

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

	it("tx.execute keeps its own pre-existing DriverRow shape -- a deliberate, tracked asymmetry (#326), not an oversight", () => {
		// `Tx = ChainApi & { execute(...): Promise<ReadonlyArray<DriverRow>> }`
		// (task 7.4): the chain members joined onto `Tx` via intersection
		// resolve their declared row type exactly like every other surface
		// above, but `execute` itself was never touched -- promoting it to
		// `ExecuteResult<TStatement>` is group 4's own contract to revise,
		// out of this group's file scope (#326 tracks closing the gap).
		type TxExecuteRows = Awaited<ReturnType<Tx["execute"]>>;
		expectTypeOf<TxExecuteRows>().toEqualTypeOf<ReadonlyArray<DriverRow>>();
		// the same `tx`'s own chain member resolves a strictly richer type
		// for the identical statement kind -- the asymmetry made concrete,
		// not just "different names for the same shape".
		expectTypeOf<TxExecuteRows>().not.toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});
});
