import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	check,
	defineTrigger,
	emptySnapshot,
	generateMigration,
	grant,
	index,
	isNotNull,
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
	extensions: [],
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

	it("reports a column's type and not-null differences together", () => {
		// A reader who fixes the reported difference and reruns must not meet
		// a *second*, previously-known difference on the same column -- both
		// axes this column actually differs on are reported from one run.
		// Plain uuid() columns throughout (no .primaryKey()) so this fixture
		// carries no primary-key constraint to also satisfy -- the point
		// here is column-axis reporting, not table sub-object existence.
		const posts = table(app, "posts", {
			id: uuid(),
			title: text().notNull(),
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
					notNull: false,
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

		expect(findings).toHaveLength(2);
		expect(
			findings.every((finding) => finding.identity === "app.posts.title"),
		).toBe(true);
		const codes = findings.map((finding) => finding.error.code).sort();
		expect(codes).toEqual(["check-object-differs", "check-object-differs"]);
		const messages = findings.map((finding) => finding.error.message).join(" ");
		expect(messages).toContain("not null");
		expect(messages).toContain("character varying(120)");
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

	it("does not report an undeclared table's missing grant as a difference", () => {
		// hejbro cannot emit a migration for a table it never declared, and
		// `grant ... on all tables in schema` only ever covered the tables
		// that existed when it ran (#121) -- a table some other tool created
		// later is unmanaged inventory (5.1), never a "missing grant" finding
		// with no fix a user could apply.
		const usage = grant(app).tables("select").to("authenticated");
		const snapshot = buildTestSnapshot([usage]);
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "legacy_table", rls: false }],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toEqual([]);
	});
});

type LocalTableNode = {
	readonly primaryKeyName?: string;
	readonly foreignKeys: ReadonlyArray<{ readonly name: string }>;
};

const uuidColumnRow = (table: string, name: string) => ({
	schema: "app",
	table,
	name,
	notNull: false,
	catalogType: "uuid",
	baseTypeKind: null,
	baseTypeSchema: null,
	baseTypeName: null,
	catalogDefault: null,
});

describe("compareCatalog / 2.5 table sub-object existence", () => {
	it("reports a missing index, foreign key and check constraint by identity", () => {
		const authors = table(app, "authors", { id: uuid() });
		const posts = table(
			app,
			"posts",
			{
				id: uuid(),
				authorId: uuid().references(() => authors.id),
			},
			(t) => ({
				indexes: [index("posts_author_idx").on(t.authorId)],
				checks: [check("posts_has_author", isNotNull(t.authorId))],
			}),
		);
		const snapshot = buildTestSnapshot([authors, posts]);
		const postsNode = snapshot.objects["table:app.posts"] as LocalTableNode;
		const fkName = postsNode.foreignKeys[0]?.name;
		if (fkName === undefined) {
			throw new Error("expected the built snapshot to declare a foreign key");
		}
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [
				{ schema: "app", table: "authors", rls: false },
				{ schema: "app", table: "posts", rls: false },
			],
			columns: [
				uuidColumnRow("authors", "id"),
				uuidColumnRow("posts", "id"),
				uuidColumnRow("posts", "author_id"),
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		const byIdentity = new Map(
			findings.map((finding) => [finding.identity, finding]),
		);
		expect(byIdentity.size).toBe(3);
		expect(byIdentity.get("app.posts.posts_author_idx")?.error.code).toBe(
			"check-object-missing",
		);
		expect(byIdentity.get(`app.posts.${fkName}`)?.error.code).toBe(
			"check-object-missing",
		);
		expect(byIdentity.get("app.posts.posts_has_author")?.error.code).toBe(
			"check-object-missing",
		);
	});

	it("reports a declared primary key the table does not have", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildTestSnapshot([posts]);
		const postsNode = snapshot.objects["table:app.posts"] as LocalTableNode;
		const pkName = postsNode.primaryKeyName;
		if (pkName === undefined) {
			throw new Error("expected the built snapshot to declare a primary key");
		}
		const catalog: Catalog = {
			...emptyCatalog(),
			tables: [{ schema: "app", table: "posts", rls: false }],
			columns: [
				{
					...uuidColumnRow("posts", "id"),
					notNull: true,
				},
			],
		};

		const findings = compareCatalog(snapshot, catalog);

		expect(findings).toHaveLength(1);
		expect(findings[0]?.identity).toBe(`app.posts.${pkName}`);
		expect(findings[0]?.error.code).toBe("check-object-missing");
	});
});
