import type { SetOpStage } from "@hejbro/core";
import { bigint, integer, schema, select, table, text } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { WithBodyInput } from "../../src/db/chain";
import type { Db } from "../../src/db/db";

// D106 round 1 of widen-set-op-execute, B1: a set operation returned as
// the body of `db.with(...)` read as its left branch alone. Every cell
// here is read at the with-body position ([OP: db.with body], the
// untracked rule: object projections widen, whole-table columns keep
// their declared nullability). The divergences the cells rest on:
// `note` notNull vs nullable, `n` integer vs bigint. The guard cells put
// the narrower branch on the LEFT — with the wider branch on the left
// the old left-only read already matched the fold, so such a cell would
// pass whether or not anything folds (its swapped twin is kept as a
// control, marked as such).
const app = schema("wso_with");
const nn = table(app, "nn", {
	id: integer().primaryKey(),
	note: text().notNull(),
});
const nul = table(app, "nul", {
	id: integer().primaryKey(),
	note: text(),
});
const narrow = table(app, "narrow", {
	id: integer().primaryKey(),
	n: integer().notNull(),
});
const wide = table(app, "wide", {
	id: integer().primaryKey(),
	n: bigint({ mode: "bigint" }).notNull(),
});

// Erased at runtime; only the instantiation expressions below use it.
declare const dbWith: Db["with"];
type RowsOf<TBody extends WithBodyInput> = Awaited<
	ReturnType<typeof dbWith<TBody>>
>[number];

// Bodies are built by arrow functions that are never invoked: only their
// return types feed the cells, so nothing runs at test time.
const nnUnionNul = () => select(nn).union(select(nul));
const nulUnionNn = () => select(nul).union(select(nn));
const narrowUnionWide = () => select(narrow).union(select(wide));
const nestedLeft = () =>
	select(narrow).union(select(wide)).except(select(narrow));
const nestedRight = () =>
	select(narrow).exceptAll(select(narrow).unionAll(select(wide)));
const objectNoJoin = () =>
	select({ id: nn.id, note: nn.note }, nn).union(
		select({ id: nul.id, note: nul.note }, nul),
	);
const plainBody = () => select(nn);

describe("db.with body: a set operation folds its branches", () => {
	it("guard: a column nullable only in the RIGHT branch reads nullable (dies when the fold is dropped)", () => {
		expectTypeOf<RowsOf<ReturnType<typeof nnUnionNul>>>().toEqualTypeOf<{
			readonly id: number;
			readonly note: string | null;
		}>();
	});

	it("control: the swapped order reads the same (passes with or without the fold)", () => {
		expectTypeOf<RowsOf<ReturnType<typeof nulUnionNn>>>().toEqualTypeOf<{
			readonly id: number;
			readonly note: string | null;
		}>();
	});

	it("guard: a column declared at a different width in the RIGHT branch reads the union", () => {
		expectTypeOf<RowsOf<ReturnType<typeof narrowUnionWide>>>().toEqualTypeOf<{
			readonly id: number;
			readonly n: number | bigint;
		}>();
	});

	it("guard: a nested set operation on either side folds through every level", () => {
		expectTypeOf<RowsOf<ReturnType<typeof nestedLeft>>>().toEqualTypeOf<{
			readonly id: number;
			readonly n: number | bigint;
		}>();
		expectTypeOf<RowsOf<ReturnType<typeof nestedRight>>>().toEqualTypeOf<{
			readonly id: number;
			readonly n: number | bigint;
		}>();
	});

	it("anchor: an object projection keeps the with position's untracked widening on both branches", () => {
		expectTypeOf<RowsOf<ReturnType<typeof objectNoJoin>>>().toEqualTypeOf<{
			readonly id: number | null;
			readonly note: string | null;
		}>();
	});

	it("anchor: a hand-written SetOpStage<P> body keeps the left-projection fallback", () => {
		expectTypeOf<RowsOf<SetOpStage<typeof nn>>>().toEqualTypeOf<{
			readonly id: number;
			readonly note: string;
		}>();
	});

	it("anchor: a plain select body is unchanged", () => {
		expectTypeOf<RowsOf<ReturnType<typeof plainBody>>>().toEqualTypeOf<{
			readonly id: number;
			readonly note: string;
		}>();
	});
});
