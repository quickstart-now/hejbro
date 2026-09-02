import { describe, expect, expectTypeOf, it } from "vitest";
import type { InsertFinal, MutationRow } from "../../src/index";
import {
	bigint,
	bytea,
	deleteFrom,
	eq,
	insert,
	integer,
	interval,
	isNotNull,
	jsonb,
	now,
	pgEnum,
	renderQuery,
	schema,
	sql,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	slug: text().notNull(),
	publishedAt: timestamptz(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});
const articleStatus = pgEnum(app, "article_status", ["draft", "published"]);
const articles = table(app, "articles", {
	id: uuid().primaryKey(),
	status: articleStatus.column().notNull(),
});
const invoices = table(app, "invoices", {
	id: uuid().primaryKey(),
	// `.notNull()` chained, not a bare `bigint()` -- a bare, unchained,
	// inline `bigint()`/`numeric()` (no `.notNull()`, no explicit `mode`,
	// no prior `const` binding) hits a **pre-existing TypeScript inference
	// defect**, confirmed pre-existing (measured against the shipped,
	// unmodified `@hejbro/query` `ColumnTsType` and the real `select()`
	// return type `SelectResult` alike, both already widened before this
	// group's own changes -- not a regression this group introduced):
	// `table<TColumns>`'s own inference pass re-widens the bare call's
	// defaulted `TMode` to the bare `NumericMode` constraint instead of
	// keeping the literal `"bigint"`/`"string"` default, so the column's
	// read *and* write type becomes `string | number | bigint` instead of
	// just `bigint` -- silently accepting `number`/`string` where STRICT
	// should reject them. Measured matrix (escalated to lead/owner, #322):
	// bare inline (`{ c: bigint() }`, `{ c: numeric() }`) is the only
	// broken shape; chaining any modifier (`.notNull()` here), an explicit
	// `mode`, or binding to a `const` first all narrow correctly. The root
	// cause lives in `bigint()`/`numeric()`'s own generic-default
	// signature (`column-builder-factories.ts`, group 3's file, out of
	// this group's scope) -- tracked for a cross-group fix decision, not
	// fixed here. Chaining `.notNull()` here is real, common user syntax
	// (matches `examples/supabase`'s own `sizeBytes: bigint().notNull()`),
	// unaffected by the defect, so this test's own green result reflects
	// the STRICT contract, not test-only setup a real caller wouldn't
	// have. Deliberately NOT adding a test that pins the bare-inline shape
	// as `string | number | bigint` -- that would fix the bug as spec.
	amountCents: bigint().notNull(),
});
// `jsonb()`/`bytea()` take no config and carry no generic mode parameter
// (unlike `bigint()`/`numeric()`), so the bare-inline inference defect
// documented on `invoices` above structurally cannot apply here -- chained
// anyway (`.notNull()`) to keep every fixture in this file in the same,
// unambiguously-safe shape.
const documents = table(app, "documents", {
	id: uuid().primaryKey(),
	payload: jsonb().notNull(),
	blob: bytea().notNull(),
});
// A dedicated fixture for the render-reachability regression below only --
// `bigint`/`interval`/`array` mutation values, `.notNull()`-chained for the
// same bare-inline-inference reason `invoices` above documents.
const metrics = table(app, "metrics", {
	id: uuid().primaryKey(),
	amount: bigint({ mode: "bigint" }).notNull(),
	duration: interval().notNull(),
	tags: text().array().notNull(),
});

describe("mutation builders", () => {
	it("renders the spec §5.2 update shape", () => {
		const query = update(posts)
			.set({ publishedAt: now() })
			.where(eq(posts.slug, "hello"))
			.returning();
		expect(renderQuery(query.updateQuery)).toBe(
			'update "app"."posts" set "published_at" = now() where "app"."posts"."slug" = \'hello\' returning "id", "slug", "published_at"',
		);
	});
	it("accepts a sql fragment as an update or delete condition", () => {
		// #386: the same Condition union the declaration medium uses.
		const updated = update(posts)
			.set({ publishedAt: now() })
			.where(sql`lower(${posts.slug}) = ${"hello"}`)
			.returning();
		expect(renderQuery(updated.updateQuery)).toContain(
			'where lower("app"."posts"."slug") = \'hello\'',
		);
		const deleted = deleteFrom(posts)
			.where(sql`char_length(${posts.slug}) > ${3}`)
			.returning();
		expect(renderQuery(deleted.deleteQuery)).toContain(
			'where char_length("app"."posts"."slug") > 3',
		);
	});
	it("renders insert with on conflict do nothing", () => {
		const query = insert(posts)
			.values({ slug: "hello" })
			.onConflictDoNothing(posts.slug);
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."posts" ("slug") values (\'hello\') on conflict ("slug") do nothing',
		);
	});
	it("refuses an empty conflict target instead of rendering on conflict ()", () => {
		// Postgres rejects `on conflict ()` at parse time; without a target the
		// clause must not be constructible rather than compile into broken SQL.
		expect(() =>
			insert(posts).values({ slug: "hello" }).onConflictDoNothing(),
		).toThrowError(expect.objectContaining({ code: "empty-conflict-target" }));
		expect(() =>
			insert(posts)
				.values({ slug: "hello" })
				.onConflictDoUpdate({ target: [], set: { slug: "renamed" } }),
		).toThrowError(/Next: name at least one declared column/);
	});
	// Reviewer freeze finding: the three render handlers `literal.ts` added
	// for `bigint`/`interval`/`array` (harden-query-layer #322 task 2.3) are
	// reachable through nothing more than the two public exports every
	// caller already has -- `insert().values()` (which builds the AST via
	// `liftColumnValue`) and `renderQuery()` (which renders it inline,
	// `expr/render-sql.ts`'s own recursive `renderExpr` -> `renderLiteral`).
	// Not dead code behind a private module boundary; a real caller's
	// `renderQuery(query.insertQuery)` (the exact call every other test in
	// this file already makes) hits all three. Each kind's own exact
	// rendering rule, pinned verbatim: `bigint` bare (no quotes), `interval`
	// quoted plus an explicit `::interval` cast (mirrors `timestamp`'s own
	// `::timestamptz`), `array` quoted with no cast at all (the target
	// column resolves the parameter type the same way `params.ts`'s own
	// bare bigint/array placeholder decision already relies on for the
	// bind-parameter path -- this is that same decision's first-ever check
	// on the *inline* render path).
	it("renders bigint/interval/array mutation values inline -- the render handlers task 2.3 added are reachable through insert().values() + renderQuery(), not dead code", () => {
		const query = insert(metrics).values({
			id: "11111111-1111-1111-1111-111111111111",
			amount: 9007199254740993n,
			duration: {
				years: 0,
				months: 1,
				days: 2,
				hours: 3,
				minutes: 4,
				seconds: 5,
				microseconds: 6,
			},
			tags: ["a", "b"],
		});
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."metrics" ("id", "amount", "duration", "tags") values (\'11111111-1111-1111-1111-111111111111\', 9007199254740993, \'0 years 1 mons 2 days 03:04:05.000006\'::interval, \'{a,b}\')',
		);
	});
	it("fills missing multi-row keys with sql default", () => {
		const query = insert(posts).values([
			{ slug: "a", publishedAt: now() },
			{ slug: "b" },
		]);
		expect(renderQuery(query.insertQuery)).toBe(
			'insert into "app"."posts" ("slug", "published_at") values (\'a\', now()), (\'b\', default)',
		);
	});
	it("returning with an object projection lists exactly those columns", () => {
		const query = insert(posts)
			.values({ slug: "hello" })
			.returning({ id: posts.id });
		expect(query.insertQuery.returning).toEqual({
			returningKind: "columns",
			columns: [
				{
					alias: "id",
					// the caller's verbatim projection key, carried for the query
					// layer's row-key remap (#339); never rendered, never stored.
					resultKey: "id",
					expr: expect.objectContaining({
						nodeKind: "columnRef",
						columnName: "id",
					}),
				},
			],
		});
		expect(renderQuery(query.insertQuery)).toContain(
			'returning "app"."posts"."id" as "id"',
		);
	});
	it("snake_cases returning projection aliases on update", () => {
		const query = update(posts)
			.set({ slug: "x" })
			.where(eq(posts.slug, "hello"))
			.returning({ publishedAt: posts.publishedAt });
		expect(renderQuery(query.updateQuery)).toContain(
			'returning "app"."posts"."published_at" as "published_at"',
		);
	});
	it("rejects an empty returning projection", () => {
		expect(() =>
			deleteFrom(posts).where(eq(posts.slug, "old")).returning({}),
		).toThrowError(expect.objectContaining({ code: "empty-returning" }));
	});
	it("renders delete with where and returning", () => {
		const query = deleteFrom(posts).where(eq(posts.slug, "old")).returning();
		expect(renderQuery(query.deleteQuery)).toBe(
			'delete from "app"."posts" where "app"."posts"."slug" = \'old\' returning "id", "slug", "published_at"',
		);
	});
	it("rejects unknown column keys with an actionable error", () => {
		expect(() => insert(posts).values({ nope: "x" } as never)).toThrowError(
			/unknown-column|unknown column key/,
		);
	});
	it("rejects column refs from tables outside the mutation's scope", () => {
		const query = update(posts)
			.set({ slug: "hello" })
			.where(isNotNull(comments.postId));
		expect(() => renderQuery(query.updateQuery)).toThrowError(
			/foreign-column-ref|join that table/,
		);
	});
});

describe("InsertFinal/UpdateFinal/DeleteFinal<TTable, TReturning> generics (task 4.11-mutation)", () => {
	// deliberately disjoint from posts's own columns (id/slug/publishedAt)
	// in both directions -- neither table's column set is a superset of the
	// other's, so plain structural width-subtyping can't sneak either
	// direction through (a strict-subset fixture would let the wider table
	// satisfy the narrower one via excess properties, which is exactly the
	// asymmetric false-pass this test caught on the first attempt).
	const otherTable = table(app, "other", {
		name: text().notNull(),
	});

	type ExtractInsertTable<T> =
		T extends InsertFinal<infer TExtracted, infer _R> ? TExtracted : never;
	type ExtractInsertReturning<T> =
		T extends InsertFinal<infer _T, infer TExtracted> ? TExtracted : never;

	it("InsertFinal<A> and InsertFinal<B> are not mutually assignable -- the phantom anchor actually narrows, not a false pass", () => {
		type InsertPosts = InsertFinal<typeof posts>;
		type InsertOther = InsertFinal<typeof otherTable>;

		// @ts-expect-error InsertOther's table (otherTable) can't stand in for InsertPosts's (posts).
		const _otherAsPosts: InsertPosts = {} as InsertOther;
		// @ts-expect-error InsertPosts's table (posts) can't stand in for InsertOther's (otherTable).
		const _postsAsOther: InsertOther = {} as InsertPosts;
	});

	it("returning() (no projection) and returning({...}) (object projection) resolve to two different TReturning instantiations, not the same erased shape either way", () => {
		const unrequested = insert(posts).values({ slug: "x" });
		const wholeRow = insert(posts).values({ slug: "x" }).returning();
		const projected = insert(posts)
			.values({ slug: "x" })
			.returning({ id: posts.id });

		type WholeReturning = ExtractInsertReturning<typeof wholeRow>;
		type ProjectedReturning = ExtractInsertReturning<typeof projected>;

		expectTypeOf<WholeReturning>().toEqualTypeOf<undefined>();
		// #622: the stage values() hands back -- returning() never called --
		// is the `never` instantiation, distinct from the no-projection
		// `undefined` one; the bare InsertFinal<T> still defaults to undefined.
		expectTypeOf<ExtractInsertReturning<typeof unrequested>>().toBeNever();
		expectTypeOf<
			ExtractInsertReturning<InsertFinal<typeof posts>>
		>().toEqualTypeOf<undefined>();
		expectTypeOf<keyof ProjectedReturning>().toEqualTypeOf<"id">();
		expectTypeOf<ProjectedReturning["id"]>().toEqualTypeOf<typeof posts.id>();
		// @ts-expect-error "id" was the only key projected -- "slug" wasn't.
		type _NotProjected = ProjectedReturning["slug"];
	});

	it("the declared table is preserved through the whole chain (values -> returning), not widened to a bare Table", () => {
		const chain = insert(posts).values({ slug: "x" }).returning();
		expectTypeOf<ExtractInsertTable<typeof chain>>().toEqualTypeOf<
			typeof posts
		>();
	});

	it("runtime carries no trace of the generic -- InsertFinal/UpdateFinal/DeleteFinal keep compiling as the bare, non-generic names existing consumers use", () => {
		const insertStage: InsertFinal = insert(posts)
			.values({ slug: "x" })
			.returning();
		expect(Object.getOwnPropertySymbols(insertStage)).toHaveLength(0);
		expect(insertStage.insertQuery.queryKind).toBe("insert");
	});
});

describe("MutationValue write-acceptance union (task 2.1, #322 -- STRICT, design.md Settled Decision 1)", () => {
	it("a default-mode bigint column accepts bigint and rejects the settled-out shapes", () => {
		// This test binds `MutationRow` itself -- the type task 2.1 owns --
		// never calling `insert()`. The runtime lift proof (a compiled
		// statement's params array actually carrying `1n` unconverted) is
		// task 2.3's own named test; keeping that assertion out of this one
		// means this test's red/green tracks only what 2.1 touches, not a
		// lift-path gap 2.2/2.3 haven't closed yet.

		// accepted: the declared read type (default mode 'bigint', task 3.4)
		// is the one shape STRICT admits.
		const _accepted: MutationRow<typeof invoices> = { amountCents: 1n };

		// @ts-expect-error a plain `number` silently loses precision past
		// Number.MAX_SAFE_INTEGER -- exactly the failure mode 'bigint' mode
		// exists to rule out. STRICT (design.md Settled Decision 1) never
		// widens back to a sibling mode's shape.
		const _rejectedNumber: MutationRow<typeof invoices> = { amountCents: 1 };

		// @ts-expect-error regression guard, not new STRICT behavior: a
		// `string` was already rejected before this change (the old
		// family-based `LiftableFor<"numeric">` was `number`-only) -- kept so
		// a future widening of the union fails here too.
		const _rejectedString: MutationRow<typeof invoices> = { amountCents: "1" };
	});
});

describe("enum write-acceptance (#422 -- the declared values are the write type)", () => {
	it("accepts a declared value and rejects any other string", () => {
		const _accepted: MutationRow<typeof articles> = { status: "draft" };

		// @ts-expect-error the whole defect: before #422 `pgEnum` was not
		// generic over its values, so the column typed as bare `string` and
		// this compiled -- the database rejected it at runtime instead.
		const _rejected: MutationRow<typeof articles> = { status: "archived" };

		// @ts-expect-error a value that merely resembles one of the declared
		// values is not one of them.
		const _rejectedCase: MutationRow<typeof articles> = { status: "Draft" };
	});
});

describe("json/jsonb + bytea raw writes (#425 -- the declaration says which type, so the value can be lifted)", () => {
	it("accepts a raw JSON value and a Uint8Array, alongside the sql escape hatch", () => {
		// The escape hatch still works, unchanged.
		const _acceptedJsonExpr: MutationRow<typeof documents> = {
			payload: sql`'{}'::jsonb`,
		};
		const _acceptedByteaExpr: MutationRow<typeof documents> = {
			blob: sql`'\x00'::bytea`,
		};

		// And a raw value now works too: reading already revives a branded
		// jsonb column as its brand, and writing is the mirror. The column's
		// own declared type is what resolves the array-vs-jsonb ambiguity
		// that `liftLiteral` cannot resolve from a bare value.
		const _acceptedJson: MutationRow<typeof documents> = { payload: { a: 1 } };
		const payloadValue: Record<string, unknown> = { a: 1 };
		const _rawJson: MutationRow<typeof documents> = { payload: payloadValue };
		const _acceptedBytea: MutationRow<typeof documents> = {
			blob: new Uint8Array([0, 255]),
		};
	});

	it("renders a json value as its serialized text with the declared cast", () => {
		const query = insert(documents)
			.values({ payload: { theme: "dark" }, blob: new Uint8Array([0, 255]) })
			.returning({ id: documents.id });
		const sqlText = renderQuery(query.insertQuery);
		expect(sqlText).toContain(`'{"theme":"dark"}'::jsonb`);
		expect(sqlText).toContain("'\\x00ff'::bytea");
	});

	it("a bytea column still refuses a plain array or string", () => {
		// @ts-expect-error bytea takes bytes, not a number array.
		const _rejectedArray: MutationRow<typeof documents> = { blob: [0, 255] };
		// @ts-expect-error nor a string -- an encoding would have to be guessed.
		const _rejectedString: MutationRow<typeof documents> = { blob: "00ff" };
	});
});

// #444 F4: a written `null` used to reach a json/jsonb column as the JSON
// document `null` (`'null'::jsonb`), not SQL NULL -- invisible to `is
// null` and satisfying a `notNull` constraint. `payload` is nullable
// here (unlike `documents.payload` above) specifically so `null` is a
// legal write to test against.
const settings = table(app, "settings", {
	id: uuid().primaryKey(),
	payload: jsonb(),
});

describe("json/jsonb null writes (#444 F4)", () => {
	it("values({payload: null}) compiles to a null parameter, not a 'null' document", () => {
		const query = insert(settings)
			.values({ payload: null })
			.returning({ id: settings.id });
		const sqlText = renderQuery(query.insertQuery);
		expect(sqlText).not.toContain("'null'");
		const payloadIndex = query.insertQuery.columnNames.indexOf("payload");
		expect(query.insertQuery.rows[0]?.[payloadIndex]).toEqual({
			nodeKind: "literal",
			literal: { literalKind: "null" },
		});
	});

	it("the sql escape hatch still writes a JSON null document", () => {
		const query = insert(settings)
			.values({ payload: sql`'null'::jsonb` })
			.returning({ id: settings.id });
		const sqlText = renderQuery(query.insertQuery);
		expect(sqlText).toContain("'null'::jsonb");
	});

	// The spec delta's own "a notNull column refuses it" half is a TYPE-
	// level claim, not a runtime one: core's own MutationRow/MutationValue
	// accept `null` for EVERY column unconditionally by design ("unlike
	// comparisons, null is a legal write", ast.ts's own MutationValue doc)
	// -- `notNull` narrows which KEYS a row must supply, never which
	// VALUES a column's write type accepts, so it is `@hejbro/query`'s
	// InsertInput/UpdateInput (InsertColumnValue's `Exclude<
	// MutationValue<TColumn>, null>` for a notNull column) that actually
	// owns this rejection, not anything in this package. See
	// `packages/query/test/types/insert-input.test.ts` — "a notNull
	// jsonb column's write type rejects null (#444 F4 spec delta)",
	// alongside the pre-existing generic case ("notNull still forbids an
	// explicit null value...") that already proved the same exclusion
	// for a plain text column.
});

// harden-query-layer #322 task 2.3 fork-1 fix: `.array()` always sets its
// own column's family to `"array"` (`column-builder.ts`'s own `array()`
// return type), regardless of the wrapped element's family -- so
// `jsonb().array()`/`bytea().array()` used to slip past the scalar
// `UnwritableFamily` gate above entirely (their OWN family was never
// `"json"`/`"bytea"`). `IsUnwritableColumn` (mutate.ts) now also inspects
// the declared *element* type name for an array column.
const documentLists = table(app, "document_lists", {
	id: uuid().primaryKey(),
	payloads: jsonb().array().notNull(),
	blobs: bytea().array().notNull(),
	tags: text().array().notNull(),
});

describe("array write-acceptance gate (task 2.3 fork 1, #322 -- json[]/bytea[] have no raw-array write path either)", () => {
	it("jsonb[]/bytea[] reject a raw array write but still accept an Expr (sql`` escape hatch)", () => {
		// accepted: same one escape hatch as the scalar case.
		const _acceptedPayloads: MutationRow<typeof documentLists> = {
			payloads: sql`'{}'::jsonb[]`,
		};
		const _acceptedBlobs: MutationRow<typeof documentLists> = {
			blobs: sql`'{}'::bytea[]`,
		};

		// Routed through variables, not fresh array literals, for the same
		// reason the scalar jsonb probe above is: excess-property checking
		// doesn't even apply to arrays the same way, but this keeps every
		// probe in this file to the same standard -- the rejection can only
		// be assignability against `IsUnwritableColumn`, never a literal-
		// shape quirk.
		const payloadsValue: ReadonlyArray<Record<string, unknown>> = [{ a: 1 }];
		const _rejectedPayloads: MutationRow<typeof documentLists> = {
			// @ts-expect-error jsonb[] has no raw-array write path -- its
			// element's own family (`json`) is `UnwritableFamily`, and
			// `IsUnwritableColumn` now inspects the array's declared element
			// type name, not just the array column's own family (which is
			// always `"array"`, never `"json"`, for any `.array()` column).
			payloads: payloadsValue,
		};

		const blobsValue: ReadonlyArray<Uint8Array> = [new Uint8Array([0])];
		const _rejectedBlobs: MutationRow<typeof documentLists> = {
			// @ts-expect-error same gate for `bytea[]`.
			blobs: blobsValue,
		};
	});

	it("a text[] column (an approved element type) accepts a plain JS array of strings", () => {
		const _accepted: MutationRow<typeof documentLists> = {
			tags: ["a", "b"],
		};
	});
});

describe('datetime write-acceptance narrowing (task 2.5, #322 -- STRICT narrows the old LiftableFor<"datetime"> = Date | string down to exactly Date)', () => {
	it("a timestamptz column accepts Date and rejects a plain ISO string", () => {
		// accepted: the declared read type is exactly `Date` (ts-type-map.ts's
		// `BaseScalarTsType`, unchanged by this group -- STRICT just started
		// tracking it faithfully instead of the old, wider family-only rule).
		const _accepted: MutationRow<typeof posts> = {
			publishedAt: new Date("2020-01-01T00:00:00.000Z"),
		};

		const _rejectedString: MutationRow<typeof posts> = {
			// @ts-expect-error a plain ISO string used to type-check here before
			// this group's change -- the old family-based
			// `LiftableFor<"datetime"> = Date | string` accepted it. STRICT
			// (design.md Settled Decision 1) narrows to exactly the declared
			// read type, `Date` only; this is a corrected-narrower surface
			// (rule 5), not new-but-unrelated behavior.
			publishedAt: "2020-01-01T00:00:00.000Z",
		};
	});
});

describe("notNullElements write-acceptance (add-array-ergonomics, task 1.2)", () => {
	// `MutationValue` reuses `ColumnReadType` directly (design.md decision 2),
	// so a `.notNullElements()` column's write type excludes `null` on the
	// element exactly like its read type does -- no separate write-side rule.
	const catalogItems = table(app, "catalog_items", {
		id: uuid().primaryKey(),
		tags: text().array().notNull(),
		labels: text().array().notNullElements().notNull(),
	});

	it("a plain array column still accepts a null element", () => {
		const _accepted: MutationRow<typeof catalogItems> = {
			tags: ["a", null],
		};
	});

	it("a notNullElements column accepts a clean array of its element type", () => {
		const _accepted: MutationRow<typeof catalogItems> = {
			labels: ["a", "b"],
		};
	});

	it("a notNullElements column rejects a null element at compile time", () => {
		const _rejected: MutationRow<typeof catalogItems> = {
			// @ts-expect-error labels is declared .notNullElements() -- its
			// element type excludes null on the write side too (reuses
			// ColumnReadType, see this describe block's own note above).
			labels: ["a", null],
		};
	});
});

describe("always-family keys are absent from MutationRow (#390 -- the input-types requirement covers core's raw builders too)", () => {
	const orders = table(app, "orders", {
		id: integer().generatedAlwaysAsIdentity(),
		// `.notNull()`-chained for the bare-inline-inference reason the
		// `invoices` fixture documents.
		amount: bigint().notNull(),
		doubled: bigint().generatedAlwaysAs(sql`amount * 2`),
		seq: bigint().generatedByDefaultAsIdentity(),
	});

	it("stored generated and always-identity carry no key; by-default identity stays writable", () => {
		// accepted: the by-default identity column is an ordinary defaulted
		// column (supply or omit), and the plain column writes as usual.
		const _accepted: MutationRow<typeof orders> = { amount: 1n, seq: 2n };
		const _acceptedOmitting: MutationRow<typeof orders> = { amount: 1n };

		// Both directives' value arm is sql`1` (`Expr<"unknown">`, valid for
		// every column) so each is consumed by the unknown-KEY error alone,
		// never a value error (the dead-directive trap, #381).

		// @ts-expect-error a stored generated column has no key at all
		const _rejectedGenerated: MutationRow<typeof orders> = { doubled: sql`1` };

		// @ts-expect-error a `generated always as identity` column has no key at all
		const _rejectedIdentity: MutationRow<typeof orders> = { id: sql`1` };

		// The keyof pin is the sole guardian of "absent, not never-valued"
		// (D100 decision 5): a `key?: never` mutant silences both directives
		// above (consumed by value errors) and dies only here.
		expectTypeOf<keyof MutationRow<typeof orders>>().toEqualTypeOf<
			"amount" | "seq"
		>();
	});
});
