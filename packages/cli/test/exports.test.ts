import * as core from "@hejbro/core";
import * as query from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { ENGINE, VOCABULARY } from "../src/core-surface";
/**
 * Type-only presence check for names the facade must carry (task 7.9,
 * group 7 decision ①) -- a `tsc` error at this import if any name is
 * missing, never a silent gap a runtime-only assertion could catch (a
 * `export type` name never produces a runtime binding). Most of these are
 * query-layer types; `DeclaredCteMarker` is core's own (add-ctes, task
 * 7.3), reaching the facade only through core's `export *` (line 10,
 * never curated by hand) -- this is what actually proves it arrived
 * rather than assuming a wildcard export always does.
 */
import type {
	AssertSchemaFinding,
	ContextProvider,
	Db,
	DbContext,
	DeclaredCteMarker,
	ExecuteResult,
	ScopedDb,
	Tx,
} from "../src/index";
import * as hejbro from "../src/index";

/** #471: the barrel's runtime export set, sorted -- regenerate by hand when the surface changes on purpose. */
const HEJBRO_RUNTIME_EXPORTS: ReadonlyArray<string> = [
	"HejbroError",
	"and",
	"asc",
	"assertNoNulls",
	"assertSchema",
	"avg",
	"between",
	"bigint",
	"bigserial",
	"boolean",
	"bytea",
	"char",
	"check",
	"cidr",
	"coalesce",
	"columnDefault",
	"columnGenerated",
	"columnIdentity",
	"columnNotNull",
	"compile",
	"count",
	"createNameKeyedDb",
	"cumeDist",
	"date",
	"db",
	"defaultContextRendering",
	"deferredStatement",
	"defineConfig",
	"defineFunction",
	"defineTrigger",
	"defineView",
	"deleteFrom",
	"denseRank",
	"desc",
	"doublePrecision",
	"eq",
	"existingTable",
	"exists",
	"expr",
	"firstValue",
	"foreignKeyActions",
	"genRandomUuid",
	"grant",
	"gt",
	"gte",
	"ilike",
	"inArray",
	"index",
	"indexMethods",
	"inet",
	"insert",
	"integer",
	"interval",
	"isNotNull",
	"isNull",
	"json",
	"jsonArrayFrom",
	"jsonObjectFrom",
	"jsonb",
	"lag",
	"lastValue",
	"lead",
	"leftJoinedBrand",
	"like",
	"literal",
	"lt",
	"lte",
	"macaddr",
	"max",
	"min",
	"ne",
	"not",
	"notBetween",
	"notExists",
	"notIlike",
	"notInArray",
	"notLike",
	"now",
	"nthValue",
	"ntile",
	"numeric",
	"op",
	"or",
	"over",
	"parseBannerBaseline",
	"parseBannerHashes",
	"parseBannerVersion",
	"percentRank",
	"pgEnum",
	"predropStatement",
	"rank",
	"real",
	"rls",
	"roleName",
	"rowNumber",
	"schema",
	"select",
	"serial",
	"smallint",
	"smallserial",
	"sql",
	"statement",
	"sum",
	"table",
	"text",
	"throwMissingCapability",
	"time",
	"timestamp",
	"timestamptz",
	"timetz",
	"update",
	"uuid",
	"varchar",
	"withCte",
];

/** Referenced so the type-only import block above isn't flagged unused. */
type _QueryTypesPresent = [
	ContextProvider,
	Db,
	DbContext,
	ExecuteResult<never>,
	ScopedDb,
	Tx,
];
type _CoreTypesPresent = [DeclaredCteMarker];
/**
 * `AssertSchemaFinding` (extend-query-runtime, owner decision: named on
 * this surface, not re-exported as `check`'s own `Finding`) carries no
 * runtime binding of its own -- a type alias produces nothing to probe
 * with `typeof` -- so its only possible check is this one: the import
 * above already fails `tsc` if the facade stops exporting it. The
 * `identity`/`error` shape assertion belongs to `assert-schema.test.ts`
 * (it is `check/compare.ts`'s own `Finding` shape, unchanged); this file
 * only pins that the *name* reaches the public entry.
 */
type _AssertSchemaTypesPresent = [AssertSchemaFinding];

describe("hejbro facade (task 7.9)", () => {
	it("exports db from @hejbro/query", () => {
		expect(typeof hejbro.db).toBe("function");
	});

	it("exports assertNoNulls from @hejbro/core (add-array-ergonomics, group 2), a live binding not a shadowed/renamed one", () => {
		expect(typeof hejbro.assertNoNulls).toBe("function");
		expect(hejbro.assertNoNulls(["a", "b"])).toEqual(["a", "b"]);
		expect.assertions(5);
		try {
			hejbro.assertNoNulls(["a", null]);
		} catch (error) {
			expect(error).toBeInstanceOf(hejbro.HejbroError);
			expect((error as InstanceType<typeof hejbro.HejbroError>).code).toBe(
				"null-array-element",
			);
			expect(
				(error as InstanceType<typeof hejbro.HejbroError>).message,
			).toMatch(/\bindex 1\b/);
		}
	});

	it("exports the window vocabulary and over() from @hejbro/core (add-window-functions task 2.3)", () => {
		expect(typeof hejbro.rowNumber).toBe("function");
		expect(typeof hejbro.rank).toBe("function");
		expect(typeof hejbro.denseRank).toBe("function");
		expect(typeof hejbro.percentRank).toBe("function");
		expect(typeof hejbro.cumeDist).toBe("function");
		expect(typeof hejbro.ntile).toBe("function");
		expect(typeof hejbro.lag).toBe("function");
		expect(typeof hejbro.lead).toBe("function");
		expect(typeof hejbro.firstValue).toBe("function");
		expect(typeof hejbro.lastValue).toBe("function");
		expect(typeof hejbro.nthValue).toBe("function");
		expect(typeof hejbro.over).toBe("function");
	});

	it("core and query's runtime export sets collide on exactly one name -- sql (the only name group 7 decision ① names as a replacement target)", () => {
		// R2 finding: a bare "sql is exported" probe proves nothing here --
		// `export * from "@hejbro/core"` alone already put a `sql` on this
		// barrel before task 7.9 touched anything, so that probe would have
		// been green even against the untouched facade (a star-shadow
		// false positive). The only thing worth asserting at this level is
		// the *shape* of the collision itself: exactly one name in common,
		// and it's the one the decision names.
		const collidingNames = Object.keys(query).filter((name) =>
			Object.hasOwn(core, name),
		);
		expect(collidingNames).toEqual(["sql"]);
	});

	it("exports the dual-use sql from @hejbro/query, not core's own -- proven by exercising a capability core's sql never had, through the facade itself", () => {
		// Existence/typeof checks alone are exactly the star-shadow trap
		// the test above calls out -- core's own `sql` is also a function
		// with a `.raw` method, so those alone can't tell the two apart.
		// `.identifier(...)` and the standalone-statement form
		// (`compile()` reading `statementExpr`) are dual-use-only (task
		// 2.6/7.1): core's own `SqlTag`
		// (packages/core/src/expr/sql-template.ts) never had either. Both
		// are exercised here *through the hejbro barrel*, not imported
		// straight from `@hejbro/query`, so the proof is about what the
		// facade actually shadows in, not about the underlying package.
		const identifierExpr = hejbro.sql.identifier("app", "posts");
		expect(identifierExpr).toBeDefined();

		const compiled = hejbro.compile(hejbro.sql`select 1`);
		expect(compiled.sql).toBe("select 1");
		expect(compiled.kind).toBe("sql");
	});

	it("fragment uses of the old sql still type-check -- index().on(sql`...`) and check(name, sql`...`)", () => {
		const app = hejbro.schema("app_exports_test");
		const members = hejbro.table(
			app,
			"members",
			{
				id: hejbro.uuid().primaryKey(),
				email: hejbro.text().notNull(),
			},
			(t) => ({
				indexes: [
					hejbro
						.index("members_email_lower_idx")
						.on(hejbro.sql`lower(${t.email})`),
				],
				checks: [
					hejbro.check(
						"members_email_not_blank",
						hejbro.sql`length(btrim(${t.email})) > 0`,
					),
				],
			}),
		);

		expect(members).toBeDefined();
	});

	it("exports assertSchema (task 2.7, extend-query-runtime), a live binding not a shadowed/renamed one", () => {
		expect(typeof hejbro.assertSchema).toBe("function");
	});
});

/**
 * #471: the barrel's curation of core. Two lists, complete by
 * construction -- a core runtime export in neither (or both) fails here,
 * so a newcomer is classified before it ships -- and the barrel's own
 * runtime export set pinned by set equality (the neon preset's
 * `entry.test.ts` shape), so an addition or removal that skips the pin
 * fails naming the difference.
 */
describe("hejbro barrel curation (#471)", () => {
	// Namespace keys, not `typeof` probes: a binding can read as undefined
	// while a module graph is still evaluating (measured: `fnv1aHex` did,
	// under vitest's source alias), and a completeness check must see it.
	const runtimeKeys = (
		module: Record<string, unknown>,
	): ReadonlyArray<string> => Object.keys(module).sort();

	const vocabulary: ReadonlyArray<string> = VOCABULARY;
	const engine: ReadonlyArray<string> = ENGINE;

	it("classifies every runtime export of @hejbro/core exactly once", () => {
		const coreKeys = runtimeKeys(core as Record<string, unknown>);
		const classified = [...vocabulary, ...engine].sort();
		const unclassified = coreKeys.filter(
			(key) => !vocabulary.includes(key) && !engine.includes(key),
		);
		const twice = vocabulary.filter((key) => engine.includes(key));
		const stale = classified.filter((key) => !coreKeys.includes(key));
		expect({ unclassified, twice, stale }).toEqual({
			unclassified: [],
			twice: [],
			stale: [],
		});
		expect(classified).toEqual(coreKeys);
	});

	it("re-exports every vocabulary name and no engine name", () => {
		const barrel = hejbro as Record<string, unknown>;
		const missing = vocabulary.filter((key) => !(key in barrel));
		const leaked = engine.filter((key) => key in barrel);
		expect({ missing, leaked }).toEqual({ missing: [], leaked: [] });
		expect(typeof hejbro.real).toBe("function");
		expect(typeof hejbro.leftJoinedBrand).not.toBe("undefined");
		// `export type *` keeps every core name visible to the type checker as
		// a type-only re-export, so the pin is a *value* use: that is what the
		// curation removes, and what a user's autocomplete stops offering.
		// @ts-expect-error renderExpr is core's engine, exported from hejbro as a type only (#471).
		const _engineGone = hejbro.renderExpr;
	});

	it("pins the barrel's runtime export set by set equality", () => {
		expect(runtimeKeys(hejbro as Record<string, unknown>)).toEqual(
			HEJBRO_RUNTIME_EXPORTS,
		);
	});
});
