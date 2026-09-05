import {
	defineFunction,
	eq,
	integer,
	jsonb,
	pgEnum,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
	varchar,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");

const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

const postStatus = pgEnum(app, "post_status", ["draft", "published"]);

type Payload = { readonly count: number };

/** A builder-declared scalar return (#433) — carries its own length, not just a bare `varchar` type node. */
const shortLabel = defineFunction(
	app,
	"short_label",
	{ returns: varchar({ length: 10 }) },
	(ctx) => {
		ctx.return(sql`'ok'`);
	},
);

/** A builder-declared enum return — the same enum a column would read as. */
const currentStatus = defineFunction(
	app,
	"current_status",
	{ returns: postStatus.column() },
	(ctx) => {
		ctx.return(sql`'draft'`);
	},
);

/** A builder-declared `$type`-branded `jsonb` return. */
const currentPayload = defineFunction(
	app,
	"current_payload",
	{ returns: jsonb().$type<Payload>() },
	(ctx) => {
		ctx.return(sql`'{}'::jsonb`);
	},
);

/** Two arguments of different families/types, named-object call convention (owner decision, task 4.10) -- `maxRows`, not `limit`, since `limit` collides with a plpgsql reserved word (fn.test.ts's own fixture hit this first). */
const searchByStatus = defineFunction(
	app,
	"search_by_status",
	{ args: { status: text(), maxRows: integer() }, returns: posts },
	(ctx, args) => {
		ctx.return(select(posts).where(eq(posts.status, args.status)));
	},
);

/** A genuinely scalar-returning function (a plain `TypeNode` literal, not a table) -- fn.test.ts's own fixture, reused here for the return-type half of this contract. */
const countPosts = defineFunction(
	app,
	"count_posts",
	{ returns: { typeName: "bigint" } },
	(ctx) => {
		ctx.return(sql`(select count(*) from "app"."posts")`);
	},
);

/** A table carrying the same enum column `currentStatus` returns -- the scalar-path agreement case needs a real column read through `select`, not another `returns`-derived type (which would just restate the claim under test). */
const articles = table(app, "articles", {
	id: uuid().primaryKey(),
	status: postStatus.column().notNull(),
});

const appSchema = {
	posts,
	articles,
	searchByStatus,
	countPosts,
	shortLabel,
	currentStatus,
	currentPayload,
};

/**
 * A minimal, inert `Driver` stub -- every test in this file is a
 * compile-time assertion (`@ts-expect-error`/`expectTypeOf`); the one
 * test that does call through (the positive control) never awaits it, so
 * this only needs to resolve without throwing, never carry real data.
 */
const driver: Driver = {
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
		"batched-transactions": false,
	},
	execute: async () => [],
	transaction: async (callback) => callback({ execute: async () => [] }),
	batch: async () => [],
	setupSession: async () => {},
};
const handle = db(appSchema, driver);

describe("db.fn.* named-argument call signature (task 4.10)", () => {
	it("the correct call shape type-checks with no error", () => {
		// never actually invoked (fn.test.ts already covers the runtime
		// wiring) -- this closure exists purely so TS type-checks the call
		// shape without a real driver round-trip happening in this file.
		const _neverCalled = () =>
			handle.fn.searchByStatus({ status: "published", maxRows: 10 });
		void _neverCalled;
	});

	it("argument types derive exactly from the declared args -- named object, one key per declared argument", () => {
		type Args = Parameters<typeof handle.fn.searchByStatus>[0];
		expectTypeOf<Args>().toEqualTypeOf<{
			readonly status: string;
			readonly maxRows: number;
		}>();
	});

	it("a typo'd argument key is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "staus" isn't a declared argument name.
			handle.fn.searchByStatus({ staus: "published", maxRows: 10 });
		void _neverCalled;
	});

	it("a missing argument key is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "status" is required and wasn't provided.
			handle.fn.searchByStatus({ maxRows: 10 });
		void _neverCalled;
	});

	it("a wrongly-typed argument value is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "status" must be a string, not a number.
			handle.fn.searchByStatus({ status: 123, maxRows: 10 });
		void _neverCalled;
	});

	it("an excess argument key (beyond the declared two) is rejected statically on a fresh object literal", () => {
		const _neverCalled = () =>
			handle.fn.searchByStatus({
				status: "published",
				maxRows: 10,
				// @ts-expect-error "extra" isn't a declared argument -- caught
				// because this object is a fresh literal at the call site (TS's
				// excess-property check doesn't fire through a variable).
				extra: "nope",
			});
		void _neverCalled;
	});

	it("a nonexistent db.fn key is rejected statically -- owner decision ③'s static pinning", () => {
		const _neverCalled = () =>
			// @ts-expect-error "doesNotExist" was never declared in appSchema.
			handle.fn.doesNotExist({});
		void _neverCalled;
	});

	it("a returns-table function resolves to ReadonlyArray<SelectResult<TTable>> -- the same mechanism select()/mutation returning() use", () => {
		type Result = Awaited<ReturnType<typeof handle.fn.searchByStatus>>;
		expectTypeOf<Result>().toEqualTypeOf<
			ReadonlyArray<SelectResult<typeof posts>>
		>();
	});

	it("a scalar-returning function resolves to the mapped scalar value itself, not rows (spec: 'resolves to a value')", () => {
		type Result = Awaited<ReturnType<typeof handle.fn.countPosts>>;
		expectTypeOf<Result>().toEqualTypeOf<bigint>();
		// @ts-expect-error a scalar result is never an array -- there is no
		// numeric index to read.
		type _NotAnArray = Result[0];
	});
});

describe("returns as a column builder resolves through ColumnReadType (#433)", () => {
	it("a parameterized type (varchar length) survives into the call's result type", () => {
		type Result = Awaited<ReturnType<typeof handle.fn.shortLabel>>;
		expectTypeOf<Result>().toEqualTypeOf<string>();
	});

	it("an enum return resolves to its own literal union, not a bare string", () => {
		type Result = Awaited<ReturnType<typeof handle.fn.currentStatus>>;
		expectTypeOf<Result>().toEqualTypeOf<"draft" | "published">();
	});

	it("the same enum read through select() and through a returns-builder function agree exactly -- the claim this task exists to pin (a table-returning case would only restate SelectResult, already proven above)", () => {
		type ColumnRead = SelectResult<typeof articles>["status"];
		type FnResult = Awaited<ReturnType<typeof handle.fn.currentStatus>>;
		expectTypeOf<ColumnRead>().toEqualTypeOf<FnResult>();
	});

	it("a $type-branded jsonb return keeps its brand, not unknown", () => {
		type Result = Awaited<ReturnType<typeof handle.fn.currentPayload>>;
		expectTypeOf<Result>().toEqualTypeOf<Payload>();
	});
});
