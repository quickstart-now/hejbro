import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	defineTrigger,
	emptySnapshot,
	generateMigration,
	grant,
	literal,
	pgEnum,
	rls,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/check/catalog";
import { compareCatalog } from "../src/check/compare";

const app = schema("app");

const buildTestSnapshot = (
	declarations: ReadonlyArray<HejbroInput>,
): Snapshot =>
	generateMigration({ declarations, previousSnapshot: emptySnapshot }).snapshot;

/** Every catalog category empty -- tests override just the categories a given comparison touches. */
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
});

describe("compareCatalog / 2.1 finding shape", () => {
	it("reports a missing table by its identity", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);

		const findings = compareCatalog(snapshot, emptyCatalog());

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-missing" });
		expect(findings[0]?.error.message).toContain("Next:");
	});
});

describe("compareCatalog / 2.2 column type comparison", () => {
	it("reports a column declared text that the catalog has as varchar(120)", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text(),
		});
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
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
				},
				{
					schema: "app",
					table: "posts",
					name: "title",
					notNull: false,
					catalogType: "character varying(120)",
					baseTypeKind: null,
					baseTypeSchema: null,
					baseTypeName: null,
					catalogDefault: null,
				},
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.title");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		expect(findings[0]?.error.message).toContain("text");
		expect(findings[0]?.error.message).toContain("character varying(120)");
	});

	it("does not report an enum column as differing because of search_path", () => {
		const status = pgEnum(app, "status", ["active", "archived"]);
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			status: status.column(),
		});
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
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
				},
				{
					schema: "app",
					table: "posts",
					name: "status",
					notNull: false,
					// A search_path where "app" isn't first reads this bare,
					// unqualified -- the comparison must not trust this spelling.
					catalogType: "status",
					baseTypeKind: "e",
					baseTypeSchema: "app",
					baseTypeName: "status",
					catalogDefault: null,
				},
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toEqual([]);
	});
});

describe("compareCatalog / 2.3 notNull and default comparison", () => {
	it("accepts a default the catalog stored with a trailing cast", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			role: text().default("member"),
		});
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
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
				},
				{
					schema: "app",
					table: "posts",
					name: "role",
					notNull: false,
					catalogType: "text",
					baseTypeKind: null,
					baseTypeSchema: null,
					baseTypeName: null,
					catalogDefault: "'member'::text",
				},
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toEqual([]);
	});

	it("reports a default the declaration has and the catalog does not", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			role: text().default("member"),
		});
		const snapshot = buildTestSnapshot([posts]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
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
				},
				{
					schema: "app",
					table: "posts",
					name: "role",
					notNull: false,
					catalogType: "text",
					baseTypeKind: null,
					baseTypeSchema: null,
					baseTypeName: null,
					catalogDefault: null,
				},
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe("app.posts.role");
		expect(findings[0]?.error).toMatchObject({ code: "check-object-differs" });
		expect(findings[0]?.error.message).toContain("member");
	});
});

describe("compareCatalog / 2.4 existence for every declared kind", () => {
	it("reports a missing policy, trigger and grant by identity", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() }, () => ({
			rls: rls.enabled({
				readAll: rls
					.policy("posts_read_all")
					.for("select")
					.to("authenticated")
					.using(literal(true)),
			}),
		}));
		const touch = defineTrigger(
			posts,
			{
				name: "posts_touch",
				timing: "before",
				events: ["update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const usage = grant(app).usage.to("authenticated");
		const snapshot = buildTestSnapshot([posts, touch, usage]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: true }],
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
				},
			],
			// posts_touch's own implicit function (posts_touch_fn) exists;
			// the policy/trigger/grant themselves do not, by design.
			functions: [{ schema: "app", name: "posts_touch_fn" }],
		};

		const findings = compareCatalog(snapshot, catalog);

		const byIdentity = new Map(
			findings.map((finding) => [finding.identity, finding]),
		);
		expect(byIdentity.size).toBe(3);
		expect(byIdentity.get("app.posts.posts_read_all")?.error.code).toBe(
			"check-object-missing",
		);
		expect(byIdentity.get("app.posts.posts_touch")?.error.code).toBe(
			"check-object-missing",
		);
		expect(byIdentity.get("app.schema-usage.authenticated")?.error.code).toBe(
			"check-object-missing",
		);
	});

	it("refuses an empty declaration set with its own code", () => {
		expect(() => compareCatalog(emptySnapshot, emptyCatalog())).toThrow(
			expect.objectContaining({ code: "check-declarations-empty" }),
		);
	});
});
