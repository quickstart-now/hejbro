import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	CteBuilder,
	CteFieldRef,
	SetOpResult,
	SetOpStage,
} from "../../src/index";
import {
	bigint,
	integer,
	schema,
	select,
	table,
	text,
	uuid,
	withCte,
} from "../../src/index";

/**
 * Observation point for every assertion in this file (widen-set-op-
 * execute, task 1.5a): `CteFieldRef<T>`'s own `T` (`@hejbro/query`'s own
 * seven-observation-point survey, #738, names this OP7) -- this package
 * is core, with no dependency on `@hejbro/query`, so a resolved ROW
 * (`SelectResult`/`ExecuteResult`, OP1-OP4) or a `handle.with(...)` read
 * (OP5/OP6) cannot be measured here at all; only the field reference's
 * own carried type. Source: a declared `Table`'s own column map for the
 * whole-table cells, a `CteReference`'s own `Expr` map for the object-
 * projection cells (the two structurally distinct sources design.md's
 * own measurement separates). Every cell below is labelled with its own
 * projection form (whole-table / object projection) in its own
 * `describe`/`it` title, already.
 */
const app = schema("app");
const flagTableNotNull = table(app, "cte_fold_flag_not_null", {
	id: uuid().primaryKey(),
	flag: text().notNull(),
});
const flagTableNullable = table(app, "cte_fold_flag_nullable", {
	id: uuid().primaryKey(),
	flag: text(),
});
// Declared-read-type divergence (not nullability): same family
// ("numeric"), different resolved TS mode -- the axis the approved 1.6
// contract text names directly ("the union of both branches' read-back
// types"), confirmed non-empty by an independent runtime measurement
// (widen-set-op-execute #738) separately from whichever nullability
// axis a given projection form turns out to carry.
const numericLeft = table(app, "cte_fold_numeric_left", {
	id: uuid().primaryKey(),
	num: integer().notNull(),
});
const numericRight = table(app, "cte_fold_numeric_right", {
	id: uuid().primaryKey(),
	num: bigint({ mode: "bigint" }).notNull(),
});

/**
 * A type-only handle on `CteBuilder["as"]`'s own generic signature --
 * never assigned, never called at runtime (only ever used inside `typeof
 * cteBuilderAs<...>`, itself only ever used in a type position, so this
 * `declare const` is fully erased and touches nothing at runtime -- the
 * same instantiation-expression technique `@hejbro/query`'s own type
 * tests use for `Db["execute"]`). Lets the fallback test below reach a
 * bare, hand-written `SetOpStage<P>` (both branch parameters at their
 * `unknown` default) as a TYPE ARGUMENT, without ever constructing or
 * calling a real value with it -- a real value-level `.union()` call
 * always fills both branches (task 1.1's own measurement, #738 P3), so
 * there is no other way to reach this path.
 */
declare const cteBuilderAs: CteBuilder["as"];

// Deliberately no `FieldValue<T> = T extends CteFieldRef<infer TValue> ?
// TValue : never`-style unwrap: measured (invariant c, below) -- `infer`
// against `CteFieldRef`'s own key-REMAPPED mapped type (`as P extends
// "exprNode" | ... ? never : P`) cannot reliably reverse-solve `TValue`
// from an already-computed concrete shape, the same class of failure
// `CteRowEnvironment`'s own `Table<infer TColumns>` branch has against a
// synthetic folded object (task 1.5's own P1 spike) -- it silently
// collapsed to `CteFieldRef`'s own default (`Expr`), not the real union,
// with no error to signal it. Every comparison below instead wraps the
// EXPECTED value in `CteFieldRef<...>` once (forward direction only) and
// compares against the real expression's own inferred type via
// `expectTypeOf(value)`, never against a hand-typed alias reconstructed
// through `typeof stage.projectionInput["key"]` (measured to diverge from
// `expectTypeOf(stage.projectionInput.key)`'s own inference for the same
// property, cause not further isolated -- avoided rather than trusted).

describe("w.as folds a core-built set operation's two branches, flat shapes (widen-set-op-execute, task 1.5a)", () => {
	it("#944 case: RIGHT branch nullable, LEFT notNull -- the reference's field type carries BOTH branches' own origin (whole-table)", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).union(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("declared-read-type divergence, both notNull (integer vs bigint mode) -- whole-table (measured non-vacuous: two structurally-identical notNull columns from DIFFERENT tables collapse to one type under `toEqualTypeOf`, since table identity carries no type-level distinction -- this cell needed a genuine value-type divergence, not just a different table, to detect the fold at all; a first attempt using two identically-shaped tables passed even with folding mutated off)", () => {
		const stage = withCte((w) => {
			const x = w.as("x", select(numericLeft).union(select(numericRight)));
			return select({ num: x.num }, x);
		});
		expectTypeOf(stage.projectionInput.num).toEqualTypeOf<
			CteFieldRef<(typeof numericLeft)["num"] | (typeof numericRight)["num"]>
		>();
	});

	it("LEFT branch nullable, RIGHT notNull -- the reverse direction (whole-table)", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNullable).union(select(flagTableNotNull)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNullable)["flag"] | (typeof flagTableNotNull)["flag"]
			>
		>();
	});

	it("#944 case, object projection: RIGHT branch nullable, LEFT notNull", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select({ flag: flagTableNotNull.flag }, flagTableNotNull).union(
					select({ flag: flagTableNullable.flag }, flagTableNullable),
				),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("declared-read-type divergence, both notNull (integer vs bigint mode) -- object projection", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select({ num: numericLeft.num }, numericLeft).union(
					select({ num: numericRight.num }, numericRight),
				),
			);
			return select({ num: x.num }, x);
		});
		expectTypeOf(stage.projectionInput.num).toEqualTypeOf<
			CteFieldRef<(typeof numericLeft)["num"] | (typeof numericRight)["num"]>
		>();
	});

	it("object projection: LEFT branch nullable, RIGHT notNull -- the reverse direction", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select({ flag: flagTableNullable.flag }, flagTableNullable).union(
					select({ flag: flagTableNotNull.flag }, flagTableNotNull),
				),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNullable)["flag"] | (typeof flagTableNotNull)["flag"]
			>
		>();
	});
});

describe("every combinator folds alike, not just union (widen-set-op-execute, task 1.5a) -- a guard, not new coverage: w.as reads CteAsResult's dispatch off SetOpStage's own shape, which every one of the six combinators returns identically (task 1.1)", () => {
	it("union", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).union(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("unionAll", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).unionAll(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("intersect", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).intersect(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("intersectAll", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).intersectAll(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("except", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).except(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});

	it("exceptAll", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).exceptAll(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<
				(typeof flagTableNotNull)["flag"] | (typeof flagTableNullable)["flag"]
			>
		>();
	});
});

describe("a hand-annotated SetOpStage<P> (unfilled branches) keeps today's exact fallback (widen-set-op-execute, task 1.5a, design.md Q2)", () => {
	it("both branch parameters left at their unknown default -- w.as() resolves the LEFT branch's own declared row alone, exactly like a plain CteReference", () => {
		// Pure type-level instantiation (no real value ever constructed or
		// called) -- `.union()` at the VALUE level always fills both branch
		// parameters (task 1.1's own measurement, #738 P3), so the only way
		// to reach the bare, unfilled fallback is a hand-written type
		// argument to `CteBuilder["as"]`'s own generic signature directly.
		type FallbackResult = ReturnType<
			typeof cteBuilderAs<SetOpStage<typeof flagTableNotNull>>
		>;
		expectTypeOf<FallbackResult["flag"]>().toEqualTypeOf<
			CteFieldRef<(typeof flagTableNotNull)["flag"]>
		>();
	});
});

describe("a non-set-op CTE entry's own row environment is unchanged (invariant a, task 1.5a — pinned by test, not argument)", () => {
	it("select() entry: the reference's field type is exactly CteFieldRef<the declared column>, the same shape as before this task", () => {
		const stage = withCte((w) => {
			const x = w.as("x", select(flagTableNotNull));
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<(typeof flagTableNotNull)["flag"]>
		>();
	});

	it("select() entry with an object projection: unchanged too", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select({ flag: flagTableNotNull.flag }, flagTableNotNull),
			);
			return select({ flag: x.flag }, x);
		});
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<(typeof flagTableNotNull)["flag"]>
		>();
	});
});

describe("the CTE fold reuses SetOpResult's own formula, not a second implementation (invariant c, task 1.5a)", () => {
	it("whole-table: the reference's field type is exactly CteFieldRef<SetOpResult's own per-key fold>, not a re-derived formula", () => {
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(flagTableNotNull).union(select(flagTableNullable)),
			);
			return select({ flag: x.flag }, x);
		});
		type ExpectedValue = SetOpResult<
			{ readonly flag: (typeof flagTableNotNull)["flag"] },
			{ readonly flag: (typeof flagTableNullable)["flag"] }
		>["flag"];
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<ExpectedValue>
		>();
	});

	it("object projection: the reference's field type is exactly CteFieldRef<SetOpResult's own per-key fold>, AND the key set matches SetOpResult's own key set exactly", () => {
		const leftProjection = { flag: flagTableNotNull.flag };
		const rightProjection = { flag: flagTableNullable.flag };
		const stage = withCte((w) => {
			const x = w.as(
				"x",
				select(leftProjection, flagTableNotNull).union(
					select(rightProjection, flagTableNullable),
				),
			);
			return select({ flag: x.flag }, x);
		});
		type Folded = SetOpResult<typeof leftProjection, typeof rightProjection>;
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<Folded["flag"]>
		>();
		// Key set equality, both directions -- no key the fold adds or drops.
		type ActualKeys = keyof typeof stage.projectionInput;
		type FoldedKeys = keyof Folded;
		expectTypeOf<ActualKeys>().toEqualTypeOf<FoldedKeys>();
	});
});

/**
 * Nesting (widen-set-op-execute, task 1.5b, OP7 throughout -- see this
 * file's own top-of-file note): a branch that is itself a nested
 * `SetOpStage` used to fall through `CteSetOpBranchProjection`'s
 * `never` arm entirely (task 1.5a's own scope boundary), collapsing
 * the outer fold to `SetOpResult<never, X> = never` -- the same
 * `never`-collapse shape `@hejbro/query`'s own task 1.2/1.3 split hit
 * for `execute()`'s own fold, now measured on the CTE surface. Each
 * cell reuses task 1.5a's own two axes (whole-table: nullability,
 * `flagTableNotNull`/`flagTableNullable`; object projection: declared-
 * read-type, `numericLeft`/`numericRight`) so the expected value can be
 * built directly from {@link SetOpResult}, nested exactly as many
 * levels as the cell's own shape, rather than hand-guessed. The flat
 * cells above (task 1.5a) are this task's own topic-external control:
 * they already prove the base fold works without nesting in the
 * picture, so a nested cell's own red is attributable to nesting
 * specifically, not to the fold itself being broken.
 */
describe("the CTE fold recurses through a nested branch (widen-set-op-execute, task 1.5b)", () => {
	it("left-nested, whole-table: (a union b) except c -- OP7, nullability axis", () => {
		const stage = withCte((w) => {
			const inner = select(flagTableNotNull).union(select(flagTableNullable));
			const x = w.as("x", inner.except(select(flagTableNotNull)));
			return select({ flag: x.flag }, x);
		});
		type Inner = SetOpResult<
			{ readonly flag: (typeof flagTableNotNull)["flag"] },
			{ readonly flag: (typeof flagTableNullable)["flag"] }
		>;
		type Outer = SetOpResult<
			Inner,
			{ readonly flag: (typeof flagTableNotNull)["flag"] }
		>;
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<Outer["flag"]>
		>();
	});

	it("right-nested, whole-table: a except (b union c) -- OP7, nullability axis", () => {
		const stage = withCte((w) => {
			const inner = select(flagTableNotNull).union(select(flagTableNullable));
			const x = w.as("x", select(flagTableNotNull).except(inner));
			return select({ flag: x.flag }, x);
		});
		type Inner = SetOpResult<
			{ readonly flag: (typeof flagTableNotNull)["flag"] },
			{ readonly flag: (typeof flagTableNullable)["flag"] }
		>;
		type Outer = SetOpResult<
			{ readonly flag: (typeof flagTableNotNull)["flag"] },
			Inner
		>;
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<Outer["flag"]>
		>();
	});

	it("three levels, whole-table: ((a union b) except c) intersect d -- OP7, nullability axis, depth is bounded by the statement, not a type budget", () => {
		const stage = withCte((w) => {
			const level1 = select(flagTableNotNull).union(select(flagTableNullable));
			const level2 = level1.except(select(flagTableNotNull));
			const x = w.as("x", level2.intersect(select(flagTableNullable)));
			return select({ flag: x.flag }, x);
		});
		type Level1 = SetOpResult<
			{ readonly flag: (typeof flagTableNotNull)["flag"] },
			{ readonly flag: (typeof flagTableNullable)["flag"] }
		>;
		type Level2 = SetOpResult<
			Level1,
			{ readonly flag: (typeof flagTableNotNull)["flag"] }
		>;
		type Level3 = SetOpResult<
			Level2,
			{ readonly flag: (typeof flagTableNullable)["flag"] }
		>;
		expectTypeOf(stage.projectionInput.flag).toEqualTypeOf<
			CteFieldRef<Level3["flag"]>
		>();
	});

	it("left-nested, object projection: (a union b) except c -- OP7, declared-read-type axis", () => {
		const stage = withCte((w) => {
			const inner = select({ num: numericLeft.num }, numericLeft).union(
				select({ num: numericRight.num }, numericRight),
			);
			const x = w.as(
				"x",
				inner.except(select({ num: numericLeft.num }, numericLeft)),
			);
			return select({ num: x.num }, x);
		});
		type Inner = SetOpResult<
			{ readonly num: (typeof numericLeft)["num"] },
			{ readonly num: (typeof numericRight)["num"] }
		>;
		type Outer = SetOpResult<
			Inner,
			{ readonly num: (typeof numericLeft)["num"] }
		>;
		expectTypeOf(stage.projectionInput.num).toEqualTypeOf<
			CteFieldRef<Outer["num"]>
		>();
	});

	it("right-nested, object projection: a except (b union c) -- OP7, declared-read-type axis", () => {
		const stage = withCte((w) => {
			const inner = select({ num: numericLeft.num }, numericLeft).union(
				select({ num: numericRight.num }, numericRight),
			);
			const x = w.as(
				"x",
				select({ num: numericLeft.num }, numericLeft).except(inner),
			);
			return select({ num: x.num }, x);
		});
		type Inner = SetOpResult<
			{ readonly num: (typeof numericLeft)["num"] },
			{ readonly num: (typeof numericRight)["num"] }
		>;
		type Outer = SetOpResult<
			{ readonly num: (typeof numericLeft)["num"] },
			Inner
		>;
		expectTypeOf(stage.projectionInput.num).toEqualTypeOf<
			CteFieldRef<Outer["num"]>
		>();
	});

	it("three levels, object projection: ((a union b) except c) intersect d -- OP7, declared-read-type axis", () => {
		const stage = withCte((w) => {
			const level1 = select({ num: numericLeft.num }, numericLeft).union(
				select({ num: numericRight.num }, numericRight),
			);
			const level2 = level1.except(
				select({ num: numericLeft.num }, numericLeft),
			);
			const x = w.as(
				"x",
				level2.intersect(select({ num: numericRight.num }, numericRight)),
			);
			return select({ num: x.num }, x);
		});
		type Level1 = SetOpResult<
			{ readonly num: (typeof numericLeft)["num"] },
			{ readonly num: (typeof numericRight)["num"] }
		>;
		type Level2 = SetOpResult<
			Level1,
			{ readonly num: (typeof numericLeft)["num"] }
		>;
		type Level3 = SetOpResult<
			Level2,
			{ readonly num: (typeof numericRight)["num"] }
		>;
		expectTypeOf(stage.projectionInput.num).toEqualTypeOf<
			CteFieldRef<Level3["num"]>
		>();
	});
});

describe("a recursive CTE entry is untouched by any of this (invariant b, task 1.5b — pinned by absence, not a positive left-join assertion)", () => {
	it("asRecursive's own anchor/term compatibility gate is unaffected -- a recursive term that is itself a set operation still type-checks, exactly as before this task (no claim about what nullability it reads back as -- #1053's own boundary, out of this change's scope)", () => {
		const stage = withCte((w) => {
			const r = w.asRecursive(
				"r",
				select(
					{ id: flagTableNotNull.id, flag: flagTableNotNull.flag },
					flagTableNotNull,
				),
				(self) =>
					select(
						{ id: self.id, flag: flagTableNotNull.flag },
						flagTableNotNull,
					).union(
						select(
							{ id: flagTableNullable.id, flag: flagTableNullable.flag },
							flagTableNullable,
						),
					),
			);
			return select({ id: r.id, flag: r.flag }, r);
		});
		expect(stage.withQuery.recursive).toBe(true);
	});
});
