import {
	defineFunction,
	defineView,
	eq,
	grant,
	pgEnum,
	rls,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";

const app = schema("app");

const posts = table(
	app,
	"posts",
	{
		id: uuid().primaryKey(),
		status: text().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			read: rls
				.policy("posts_read_published")
				.for("select")
				.to("policy_reader")
				.using(eq(t.status, "published")),
		}),
	}),
);

const helloWorld = defineFunction(
	app,
	"hello_world",
	{ returns: posts },
	(ctx) => {
		ctx.return(select(posts));
	},
);

const readerGrant = grant(app).usage.to("grant_reader");

const postStatus = pgEnum(app, "post_status", ["draft", "published"]);

const publishedPosts = defineView(
	app,
	"published_posts",
	select(posts).where(eq(posts.status, "published")),
);

/** A namespace-style schema module fixture (owner decision (c')): tables, a function, a grant-set, kinds `db()` never classifies (enum, view), and one incidental non-declaration export mixed together, exactly like `import * as schema from "./app.schema"` would produce. */
const appSchema = {
	posts,
	helloWorld,
	readerGrant,
	postStatus,
	publishedPosts,
	// an ordinary string export with nothing to do with roles -- must
	// never be treated as a role candidate (see db.ts's own DbOptions
	// tsdoc: auto-collecting string exports would let a typo'd role
	// coincidentally match one and defeat "reject a typo immediately").
	unrelatedExport: "not-a-role-just-a-constant",
};

/** `{ contributedRoles }` when given a value, or `{}` when omitted -- spread onto the fixture driver so `exactOptionalPropertyTypes` never sees an explicit `undefined` (house style: no ternary, so a guard clause per branch instead of one expression). */
const contributedRolesField = (
	contributedRoles: ReadonlyArray<string> | undefined,
): Pick<Driver, "contributedRoles"> | Record<string, never> => {
	if (contributedRoles === undefined) {
		return {};
	}
	return { contributedRoles };
};

const fakeDriver = (contributedRoles?: ReadonlyArray<string>): Driver => ({
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
		"batched-transactions": false,
	},
	execute: vi.fn(async () => []),
	transaction: vi.fn(async (callback) =>
		callback({ execute: vi.fn(async () => []) }),
	),
	batch: vi.fn(async () => []),
	setupSession: vi.fn(async () => {}),
	...contributedRolesField(contributedRoles),
});

describe("db(schema, driver, options?) -- owner decision (c') auto-classification", () => {
	it("classifies tables by isTable(), not by which key they're exported under", () => {
		const handle = db(appSchema, fakeDriver());

		expect(Object.keys(handle.declarations.tables)).toEqual(["posts"]);
		expect(handle.declarations.tables.posts).toBe(posts);
	});

	it('classifies functions by declarationKind === "function"', () => {
		const handle = db(appSchema, fakeDriver());

		expect(Object.keys(handle.declarations.functions)).toEqual(["helloWorld"]);
		expect(handle.declarations.functions.helloWorld).toBe(helloWorld);
	});

	it("ignores a grant-set and an unrelated string export for tables/functions -- neither ends up in either bucket", () => {
		const handle = db(appSchema, fakeDriver());

		expect(handle.declarations.tables).not.toHaveProperty("readerGrant");
		expect(handle.declarations.functions).not.toHaveProperty("readerGrant");
		expect(handle.declarations.tables).not.toHaveProperty("unrelatedExport");
		expect(handle.declarations.functions).not.toHaveProperty("unrelatedExport");
	});
});

describe("db()'s role whitelist -- the 4-source union (owner decision (c')/4.7)", () => {
	it("collects a grant's role", () => {
		const handle = db(appSchema, fakeDriver());
		expect(handle.declarations.roles.has("grant_reader")).toBe(true);
	});

	it("collects an RLS policy's role, walked from the table's own declaration", () => {
		const handle = db(appSchema, fakeDriver());
		expect(handle.declarations.roles.has("policy_reader")).toBe(true);
	});

	it("collects the roles option's explicit Role values (omitted vs. supplied changes the outcome, not just present-when-supplied)", () => {
		const withoutOption = db(appSchema, fakeDriver());
		const withOption = db(appSchema, fakeDriver(), {
			roles: [roleName("app_admin")],
		});

		expect(withoutOption.declarations.roles.has("app_admin")).toBe(false);
		expect(withOption.declarations.roles.has("app_admin")).toBe(true);
	});

	it("collects a driver's contributedRoles (empty contributor vs. a real contributor changes the outcome)", () => {
		const withoutContribution = db(appSchema, fakeDriver());
		const withContribution = db(appSchema, fakeDriver(["service_role"]));

		expect(withoutContribution.declarations.roles.has("service_role")).toBe(
			false,
		);
		expect(withContribution.declarations.roles.has("service_role")).toBe(true);
	});

	it("never collects an unrelated string export as a role -- only grant/policy/roles-option/driver contribute", () => {
		const handle = db(appSchema, fakeDriver());
		expect(handle.declarations.roles.has("not-a-role-just-a-constant")).toBe(
			false,
		);
	});

	it("a plain string in the roles option is a compile error -- Role's brand, not a bare string, is required", () => {
		db(appSchema, fakeDriver(), {
			// @ts-expect-error "app_admin" must be branded via roleName(), a plain string isn't a Role.
			roles: ["app_admin"],
		});
	});
});

describe("db()'s declaration retention (task 1.1/1.2, extend-query-runtime) -- the assertion's own input", () => {
	it("keeps a declaration that is neither a table nor a function", () => {
		const handle = db(appSchema, fakeDriver());

		expect(handle.schema.posts).toBe(posts);
		expect(handle.schema.helloWorld).toBe(helloWorld);
		expect(handle.schema.readerGrant).toBe(readerGrant);
		expect(handle.schema.postStatus).toBe(postStatus);
		expect(handle.schema.publishedPosts).toBe(publishedPosts);
	});

	it("retained declarations are the module's own objects, and classification is unaffected by retention", () => {
		const handle = db(appSchema, fakeDriver());

		expect(handle.schema).toBe(appSchema);
		expect(Object.keys(handle.declarations.tables)).toEqual(["posts"]);
		expect(handle.declarations.tables.posts).toBe(posts);
		expect(Object.keys(handle.declarations.functions)).toEqual(["helloWorld"]);
		expect(handle.declarations.functions.helloWorld).toBe(helloWorld);
		// The whole set, not membership checks (task 1.4): a `.has()` pair
		// only proves those two roles are present, never that nothing else
		// snuck in.
		expect([...handle.declarations.roles].sort()).toEqual([
			"grant_reader",
			"policy_reader",
		]);
	});
});
