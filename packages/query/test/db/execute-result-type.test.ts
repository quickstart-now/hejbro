import type {
	DeleteFinal,
	InsertFinal,
	IntervalValue,
	QueryNode,
	SelectLimited,
	UpdateFinal,
} from "@hejbro/core";
import { bigint, interval, schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { CompileInput } from "../../src/compile/compile";
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

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | number | string | null;
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

describe("Db.execute's resolved row type for mutations (task 4.11-mutation)", () => {
	it("insert().returning() (no projection) resolves the whole declared table's shape", () => {
		type Stage = InsertFinal<Posts>;

		expectTypeOf<ExecuteRows<Stage>>().toEqualTypeOf<
			ReadonlyArray<SelectResult<Posts>>
		>();
	});

	it("insert().returning({...}) (object projection) resolves exactly those keys -- a different instantiation from the whole-table case, not the same erased shape", () => {
		type Stage = InsertFinal<Posts, { readonly total: Posts["amount"] }>;
		type Row = ExecuteRows<Stage>[number];

		expectTypeOf<Row>().toEqualTypeOf<{
			readonly total: bigint | number | string | null;
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
		// object-projection widening (select-result.ts's own FamilyReadType
		// branch, #311): a projected ColumnRef alone carries no notNull
		// information, so even posts.id (declared primaryKey/notNull)
		// widens to `| null` here -- the same honest widening the select-
		// side object-projection test above already covers.
		expectTypeOf<ExecuteRows<DeleteStage>[number]>().toEqualTypeOf<{
			readonly id: string | null;
		}>();
	});
});
