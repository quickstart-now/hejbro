import type { HejbroDeclaration, KindRegistry, ObjectKind } from "@hejbro/core";
import {
	createDefaultRegistry,
	HejbroError,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { registerSupabaseKinds, storageBucket } from "@hejbro/supabase";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	AssertSchemaHandle,
	AssertSchemaNotComparedEntry,
	AssertSchemaReport,
} from "../src/assert-schema";
import { assertSchema } from "../src/assert-schema";
import type { Catalog } from "../src/check/catalog";
import { CHECK_CATALOG_QUERIES } from "../src/check/catalog";
import type { Finding } from "../src/check/compare";

const app = schema("app");

/** Mirrors `check-catalog.test.ts`'s own `emptyCatalog` -- every category empty, tests override just the categories a given fixture touches. */
const emptyCatalog = (): Catalog => ({
	schemas: [],
	tables: [],
	columns: [],
	constraints: [],
	indexes: [],
	enums: [],
	sequences: [],
	functions: [],
	views: [],
	policies: [],
	triggers: [],
	tableGrants: [],
	schemaUsageGrants: [],
	defaultTableGrants: [],
	extensions: [],
});

type CatalogQueryKey = keyof typeof CHECK_CATALOG_QUERIES;

/** A fake single-connection session that answers each `readCatalog` query by matching its exact text against `CHECK_CATALOG_QUERIES` -- the same technique `check-catalog.test.ts` uses, kept local since each check-suite test file owns its own fixtures. */
const fakeSession = (catalog: Catalog): DriverSession => ({
	execute: async (compiled: CompileResult) => {
		const entry = (
			Object.entries(CHECK_CATALOG_QUERIES) as ReadonlyArray<
				[CatalogQueryKey, string]
			>
		).find(([, sql]) => sql === compiled.sql);
		if (entry === undefined) {
			throw new Error(`unexpected query sent by assertSchema: ${compiled.sql}`);
		}
		return catalog[entry[0]] as ReadonlyArray<DriverRow>;
	},
});

/** A session that records every call it receives -- the driver-never-called proof (declaration-ownership refusal happens before any catalog read, spec: "Constructing a handle never connects", same technique reused for this earlier refusal). */
const countingSession = (
	catalog: Catalog,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const inner = fakeSession(catalog);
	return {
		calls,
		session: {
			execute: async (compiled) => {
				calls.push(compiled);
				return inner.execute(compiled);
			},
		},
	};
};

const posts = table(app, "posts", { id: uuid().primaryKey() });

/** A catalog that matches `posts` exactly -- `id uuid primary key`, nothing else declared. */
const matchingCatalog = (): Catalog => ({
	...emptyCatalog(),
	tables: [{ schema: "app", table: "posts", rls: false }],
	constraints: [
		{
			schema: "app",
			table: "posts",
			name: "posts_pkey",
			type: "p",
			columns: ["id"],
		},
	],
	columns: [
		{
			schema: "app",
			table: "posts",
			name: "id",
			notNull: true,
			catalogType: "uuid",
			baseTypeKind: null,
			baseTypeSchema: null,
			baseTypeName: null,
			catalogDefault: null,
			catalogGenerated: null,
		},
	],
});

const handleOf = (
	schemaModule: Record<string, unknown>,
	catalog: Catalog,
): AssertSchemaHandle => ({
	schema: schemaModule,
	driver: fakeSession(catalog),
});

describe("assertSchema / 2.1 public surface", () => {
	it("a matching database passes", async () => {
		await expect(
			assertSchema(handleOf({ posts }, matchingCatalog())),
		).resolves.toBeDefined();
	});

	it("a missing declared table throws naming it", async () => {
		await expect(
			assertSchema(handleOf({ posts }, emptyCatalog())),
		).rejects.toMatchObject({
			code: "assert-schema-diverged",
		});
	});

	it("the report's type is not widened to unknown", () => {
		expectTypeOf<
			Awaited<ReturnType<typeof assertSchema>>
		>().toEqualTypeOf<AssertSchemaReport>();
	});
});

describe("assertSchema / 2.2 the diverged failure carries one finding per object", () => {
	it("the thrown error carries one finding per diverging object", async () => {
		const authors = table(app, "authors", { id: uuid().primaryKey() });
		const handle = handleOf({ posts, authors }, emptyCatalog());

		await expect(assertSchema(handle)).rejects.toMatchObject({
			code: "assert-schema-diverged",
			findings: [
				expect.objectContaining({ identity: "app.authors" }),
				expect.objectContaining({ identity: "app.posts" }),
			],
		});
	});

	/**
	 * Reuse, not reconstruction (owner decision, 2.1/2.2). A literal
	 * substring pinned from `compare.ts`'s own `missingFinding` template,
	 * not a value computed by calling `compareCatalog` a second time in
	 * this test -- calling it twice would make this assertion compare
	 * "live output" against "the same live output" and could never go red
	 * for a text change, since both sides would move together. Pinning the
	 * literal is what makes a one-character edit to that template (a
	 * temporary, reverted drill, never a committed change to `check/*`)
	 * actually redden this test.
	 */
	it("the finding message is compareCatalog's own text, not a rebuilt one", async () => {
		const handle = handleOf({ posts }, emptyCatalog());

		expect.assertions(1);
		try {
			await assertSchema(handle);
		} catch (error) {
			const findings = (error as { readonly findings?: ReadonlyArray<Finding> })
				.findings;
			const postsFinding = findings?.find((f) => f.identity === "app.posts");
			expect(postsFinding?.error.message).toBe(
				'declared table "app.posts" was not found in the database. Next: apply the migration that creates it, or remove the declaration if it is no longer needed.',
			);
		}
	});
});

/**
 * Cause ⓒ: a registered kind whose objects it declares are never
 * comparable (`noCatalogObjectReason`) -- mirrors `check-compare.test.ts`'s
 * own `uncatalogableKind` (#482). A real `.register()`ed `ObjectKind`, so
 * `generateMigration` builds it into the snapshot cleanly (an entirely
 * *unregistered* declarationKind makes `buildSnapshot` throw
 * `unowned-declaration` before comparison ever starts -- a different,
 * harder failure, group 2's open question, not exercised here).
 */
const neverComparableKind: ObjectKind<HejbroDeclaration> = {
	kind: "toy-mystery",
	dependsOn: [],
	owns: (d): d is HejbroDeclaration => d.declarationKind === "toy-mystery",
	serialize: () => ({}),
	identify: () => "widget",
	diff: () => [],
	emit: () => [],
	noCatalogObjectReason: "toy objects have no catalog counterpart.",
};

const widgetDeclaration: HejbroDeclaration = { declarationKind: "toy-mystery" };

/**
 * Cause ⓑ: a registered kind `compareCatalog` itself has no comparator
 * for (compare.ts's own `KIND_COMPARATORS`, hardcoded to the 10 core
 * kinds) -- "a comparison that should have run and could not". No
 * in-repo kind reaches this today (`KIND_COMPARATORS` matches core's own
 * 10 registered kinds exactly); this fixture is the future-coverage case
 * the delta itself calls out, kept as a live contract rather than
 * deleted for having no instance yet.
 */
const shouldHaveComparedKind: ObjectKind<HejbroDeclaration> = {
	kind: "toy-uncomparable",
	dependsOn: [],
	owns: (d): d is HejbroDeclaration => d.declarationKind === "toy-uncomparable",
	serialize: () => ({}),
	identify: () => "gadget",
	diff: () => [],
	emit: () => [],
};

const gadgetDeclaration: HejbroDeclaration = {
	declarationKind: "toy-uncomparable",
};

const registryWithBothToyKinds = (): KindRegistry => {
	const registry = createDefaultRegistry();
	registry.register(neverComparableKind);
	registry.register(shouldHaveComparedKind);
	return registry;
};

describe("assertSchema / 2.3 could not compare is not success", () => {
	it("cause b (should have compared) fails under its own code, distinct from a real divergence's", async () => {
		const handle = handleOf(
			{ posts, gadget: gadgetDeclaration },
			matchingCatalog(),
		);

		await expect(
			assertSchema(handle, { registry: registryWithBothToyKinds() }),
		).rejects.toMatchObject({ code: "assert-schema-not-compared" });
	});

	it("opting out of cause b still names the uncompared declaration in what the caller receives", async () => {
		const handle = handleOf(
			{ posts, gadget: gadgetDeclaration },
			matchingCatalog(),
		);

		const report = await assertSchema(handle, {
			registry: registryWithBothToyKinds(),
			allowNotCompared: true,
		});

		expect(report.notCompared.map((entry) => entry.identity)).toContain(
			"gadget",
		);
	});

	it("cause c (never comparable) does not fail the run at all -- reported, not failed on", async () => {
		const handle = handleOf(
			{ posts, mystery: widgetDeclaration },
			matchingCatalog(),
		);

		const report = await assertSchema(handle, {
			registry: registryWithBothToyKinds(),
		});

		expect(report.notCompared).toEqual([
			{
				identity: "widget",
				reason: neverComparableKind.noCatalogObjectReason,
			},
		]);
	});
});

describe("assertSchema / 2.4 the registry is an explicit parameter", () => {
	it("defaults to the generic Postgres registry when none is supplied", async () => {
		const handle = handleOf({ posts }, matchingCatalog());

		const report = await assertSchema(handle);

		expect(report.compared.map((entry) => entry.identity)).toContain(
			"app.posts",
		);
	});

	/**
	 * Without its registry, a preset declaration is refused at declaration
	 * ownership -- before the catalog is ever read (owner decision:
	 * "without registry -> earlier and clearer failure, at declaration
	 * ownership, naming the preset to register"). Propagated as
	 * `generateMigration`'s own `unowned-declaration` `HejbroError`,
	 * unwrapped -- that failure already speaks this caller's vocabulary.
	 */
	it("without its registry, a preset declaration is refused outright, before the catalog is read", async () => {
		const { session, calls } = countingSession(matchingCatalog());
		const handle: AssertSchemaHandle = {
			schema: { posts, mystery: widgetDeclaration },
			driver: session,
		};

		expect.assertions(4);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("unowned-declaration");
			// Propagation means untouched, not merely same-coded: no cause was
			// added (there is nothing to attribute one to -- this *is* the
			// original failure).
			expect((error as { readonly cause?: unknown }).cause).toBeUndefined();
		}
		// The driver-never-called proof: ownership is decided before any
		// catalog read, so a session that records every call it receives
		// recorded none.
		expect(calls).toHaveLength(0);
	});

	/**
	 * Supplying the registry the preset contributes turns that outright
	 * refusal into a stated, non-failing boundary (owner decision) -- the
	 * declaration becomes cause ⓒ (registered, `noCatalogObjectReason`),
	 * never "compared": no registry makes a preset's own objects
	 * comparable through this assertion (spec).
	 */
	it("supplying the registry turns the refusal into a stated boundary, not into a comparison", async () => {
		const registry = createDefaultRegistry();
		registry.register(neverComparableKind);
		const handle = handleOf(
			{ posts, mystery: widgetDeclaration },
			matchingCatalog(),
		);

		const report = await assertSchema(handle, { registry });

		expect(report.notCompared.map((entry) => entry.identity)).toContain(
			"widget",
		);
		expect(report.compared.map((entry) => entry.identity)).not.toContain(
			"widget",
		);
	});
});

/**
 * The same two 2.4 scenarios again, this time through a real preset
 * (`@hejbro/supabase`'s storage bucket) rather than the toy kind above --
 * the toy kind proves the mechanism; this proves the mechanism is the
 * exact path a real user takes (delta scenarios name "a preset's
 * declaration"/"the registry its preset contributes" explicitly).
 * `packages/supabase` is read-only here, an existing devDependency of
 * `packages/cli`.
 */
describe("assertSchema / 2.4 through a real preset (@hejbro/supabase storage bucket)", () => {
	it("without the supabase registry, a storage bucket declaration is refused outright, before the catalog is read", async () => {
		const avatars = storageBucket("avatars");
		const { session, calls } = countingSession(matchingCatalog());
		const handle: AssertSchemaHandle = {
			schema: { posts, avatars },
			driver: session,
		};

		expect.assertions(4);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("unowned-declaration");
			expect((error as { readonly cause?: unknown }).cause).toBeUndefined();
		}
		expect(calls).toHaveLength(0);
	});

	it("supplying registerSupabaseKinds's registry turns the refusal into a stated boundary", async () => {
		const avatars = storageBucket("avatars");
		const registry = createDefaultRegistry();
		registerSupabaseKinds(registry);
		const handle = handleOf({ posts, avatars }, matchingCatalog());

		const report = await assertSchema(handle, { registry });

		expect(report.notCompared).toEqual([
			{
				identity: "avatars",
				reason: expect.stringContaining("Storage"),
			},
		]);
		expect(report.compared.map((entry) => entry.identity)).not.toContain(
			"avatars",
		);
	});
});

describe("assertSchema / 2.6 the two uncompared causes are independently observable", () => {
	it("cause b carries a code -- the comparison's own, reused verbatim", async () => {
		const handle = handleOf(
			{ posts, gadget: gadgetDeclaration },
			matchingCatalog(),
		);

		const report = await assertSchema(handle, {
			registry: registryWithBothToyKinds(),
			allowNotCompared: true,
		});

		const entry = report.notCompared.find((e) => e.identity === "gadget");
		expect(entry?.code).toBe("check-not-compared");
	});

	/**
	 * Same reasoning as 2.2's own reuse test: a literal pinned from
	 * `compare.ts`'s `notComparedFinding` template, not a second live
	 * `compareCatalog` call -- a live-vs-live comparison could never go
	 * red for a text change in that template, since both sides would move
	 * together.
	 */
	it("cause b's reason is compareCatalog's own finding message, not rebuilt", async () => {
		const handle = handleOf(
			{ posts, gadget: gadgetDeclaration },
			matchingCatalog(),
		);

		const report = await assertSchema(handle, {
			registry: registryWithBothToyKinds(),
			allowNotCompared: true,
		});

		const entry = report.notCompared.find((e) => e.identity === "gadget");
		expect(entry?.reason).toBe(
			'declared object "toy-uncomparable:gadget" has an unrecognized kind "toy-uncomparable" and could not be compared. Next: check for a typo in the declaration, or update hejbro if this is a new kind.',
		);
	});

	it("cause c carries no code -- the type checker itself proves this state is expressible", () => {
		// Type-only: omitting `code` entirely must type-check (owner
		// decision, 2.6) -- if `code` were required, this object literal
		// would fail `check-types`, not this test's runtime.
		const causeC: AssertSchemaNotComparedEntry = {
			identity: "widget",
			reason: "toy objects have no catalog counterpart.",
		};
		expect(causeC.code).toBeUndefined();
	});

	it("a mixed run's default failure comes from cause b alone, never cause c", async () => {
		const handle = handleOf(
			{ posts, gadget: gadgetDeclaration, mystery: widgetDeclaration },
			matchingCatalog(),
		);

		await expect(
			assertSchema(handle, { registry: registryWithBothToyKinds() }),
		).rejects.toMatchObject({ code: "assert-schema-not-compared" });

		const report = await assertSchema(handle, {
			registry: registryWithBothToyKinds(),
			allowNotCompared: true,
		});
		expect(report.notCompared.map((entry) => entry.identity).sort()).toEqual([
			"gadget",
			"widget",
		]);
	});

	it("a run whose only gap is cause c completes -- compared can be empty and it still passes", async () => {
		const handle = handleOf({ mystery: widgetDeclaration }, emptyCatalog());
		const registry = createDefaultRegistry();
		registry.register(neverComparableKind);

		const report = await assertSchema(handle, { registry });

		expect(report.compared).toEqual([]);
		expect(report.notCompared).toEqual([
			{
				identity: "widget",
				reason: neverComparableKind.noCatalogObjectReason,
			},
		]);
	});
});

describe("assertSchema / empty schema module cannot answer either", () => {
	it("fails the same way as any other unanswerable run, naming declarations (not a registry) as the fix", async () => {
		const handle = handleOf({}, emptyCatalog());

		await expect(assertSchema(handle)).rejects.toMatchObject({
			code: "assert-schema-not-compared",
		});
	});

	it("keeps compareCatalog's own refusal as cause, not discarded", async () => {
		const handle = handleOf({}, emptyCatalog());

		expect.assertions(4);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect((error as { readonly cause?: unknown }).cause).toMatchObject({
				code: "check-declarations-empty",
			});
			// The remedy names declarations, never "supply the registry" --
			// cause b's own remedy text (a registry genuinely helps there);
			// an empty module has no kind for a registry to cover.
			expect((error as Error).message).toContain("declaration");
			expect((error as Error).message).not.toContain("supply the registry");
			// A translated failure is the runtime-layer shape, never
			// HejbroError -- the declaration-time class belongs to the
			// vocabulary this failure was translated OUT of.
			expect(error).not.toBeInstanceOf(HejbroError);
		}
	});
});

describe("assertSchema / error vocabulary -- class is not the contract, code is", () => {
	it("a propagated failure keeps its original HejbroError class", async () => {
		const handle = handleOf({ mystery: widgetDeclaration }, matchingCatalog());

		expect.assertions(1);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
		}
	});

	it("a translated failure is a plain runtime error, not HejbroError", async () => {
		const handle = handleOf({}, emptyCatalog());

		expect.assertions(1);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect(error).not.toBeInstanceOf(HejbroError);
		}
	});

	it("both classes carry .code -- the one surface a caller reads regardless", async () => {
		const propagated = handleOf(
			{ mystery: widgetDeclaration },
			matchingCatalog(),
		);
		const translated = handleOf({}, emptyCatalog());

		expect.assertions(2);
		try {
			await assertSchema(propagated);
		} catch (error) {
			expect((error as { readonly code?: unknown }).code).toBe(
				"unowned-declaration",
			);
		}
		try {
			await assertSchema(translated);
		} catch (error) {
			expect((error as { readonly code?: unknown }).code).toBe(
				"assert-schema-not-compared",
			);
		}
	});

	/**
	 * `readCatalog`'s own `check-catalog-unreadable` (a `hejbro check`
	 * vocabulary code) is translated the same way `check-declarations-empty`
	 * is: this library's own code, cause preserved, plain-Error class.
	 */
	it("a catalog read failure is translated, cause preserved", async () => {
		const brokenSession: DriverSession = {
			execute: async () => {
				throw new Error("connection reset");
			},
		};
		const handle: AssertSchemaHandle = {
			schema: { posts },
			driver: brokenSession,
		};

		expect.assertions(3);
		try {
			await assertSchema(handle);
		} catch (error) {
			expect((error as { readonly code?: unknown }).code).toBe(
				"assert-schema-catalog-unreadable",
			);
			expect((error as { readonly cause?: unknown }).cause).toMatchObject({
				code: "check-catalog-unreadable",
			});
			expect(error).not.toBeInstanceOf(HejbroError);
		}
	});
});
