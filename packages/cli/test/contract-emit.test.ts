import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	defineTrigger,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import { buildFixturePayload } from "./support/contract-fixture";

const app = schema("app");

const buildDeclarations = (): ReadonlyArray<HejbroInput> => {
	const posts = table(app, "posts", {
		id: uuid().primaryKey().defaultRandom(),
		title: text().notNull(),
	});
	return [app, posts];
};

describe("the metadata's runtime name map (5.1 follow-up, planner-confirmed)", () => {
	it("carries every table's schema, SQL name, and TS-key-to-SQL-name column map", () => {
		const postId = uuid().primaryKey().defaultRandom();
		const posts = table(app, "posts", { postId });
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, {
			commit: "abc123",
			exportHash: "sha256:deadbeef",
		});

		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('schema: "app"');
		expect(metadataBlock).toContain('name: "posts"');
		expect(metadataBlock).toContain('"postId": { sqlName: "post_id"');
		// The three facts `@hejbro/query`'s row conversion reads at runtime
		// (typeNode, mode, notNullElements) -- and only those (planner
		// condition ④: no primaryKey/unique/defaultValue, which never affect
		// query compilation or row conversion).
		expect(metadataBlock).toContain('typeNode: {"typeName":"uuid"}');
		expect(metadataBlock).toContain("mode: null");
		expect(metadataBlock).toContain("notNullElements: false");
		expect(metadataBlock).not.toContain("primaryKey");
		expect(metadataBlock).not.toContain("defaultValue");
	});

	it("carries a managed relation's foreign key facts for relation-following", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		const payload = buildFixturePayload([app, authors, posts]);
		const source = emitContract(payload, {
			commit: "abc123",
			exportHash: "sha256:deadbeef",
		});

		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('referencesSchema: "app"');
		expect(metadataBlock).toContain('referencesTable: "authors"');
		expect(metadataBlock).toContain('columns: ["author_id"]');
	});
});

const ORIGIN = { commit: "abc123", exportHash: "sha256:deadbeef" };

describe("emitContract", () => {
	it("two runs against one commit are byte-identical", () => {
		const payload = buildFixturePayload(buildDeclarations());

		const first = emitContract(payload, ORIGIN);
		const second = emitContract(payload, ORIGIN);

		expect(first).toBe(second);
	});

	it("carries no timestamp", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it("the factory takes only a connection", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("export const createDb = (conn: Driver)");
		// No generic reaches the *caller* of createDb (proposal.md, "no type
		// parameter reaches the user") -- the factory's own signature line
		// carries no angle bracket. The generic binding happens one line
		// down, inside this module, where `createNameKeyedDb<Database>` is
		// called with the contract's own type -- that's 6.12's own wiring,
		// not something a caller of `createDb(conn)` ever writes.
		const factoryLine =
			source
				.split("\n")
				.find((line) => line.startsWith("export const createDb")) ?? "";
		expect(factoryLine).not.toContain("<");
	});

	it("R2-G6 6.12: createDb calls the real name-keyed client, bound to this module's own Database", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('import type { Driver } from "hejbro";');
		expect(source).toContain('import { createNameKeyedDb } from "hejbro";');
		expect(source).toContain(
			"createNameKeyedDb<Database>(conn, contractMetadata)",
		);
	});

	it("exports the commit and export identity", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('commit: "abc123"');
		expect(source).toContain('exportHash: "sha256:deadbeef"');
	});

	it("no relation is derived for an unmanaged target", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		// Only `posts` is exported -- `authors` exists as a declaration (so
		// the foreign key itself is valid) but never reaches the snapshot,
		// which is exactly "a table the export does not describe" (5.9):
		// the export step only ever sees what generation is handed.
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly authorId: string;");
		expect(source).not.toContain("app.authors");
		expect(source).toContain("readonly Relationships: readonly [];");
	});

	it("carries a relation to a managed target", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		const payload = buildFixturePayload([app, authors, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('referencedRelation: "app.authors"');
	});
});

describe("the Functions section (#587)", () => {
	it("emits a Functions entry per exported function", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		// Declared TS key differs from its SQL name (postStatus -> post_status)
		// and the second function's arg uses a non-default numeric mode
		// (bigint({mode:"number"})) -- a join keyed by sqlName, or an
		// implementation that ignores mode, both stay green on a fixture
		// where key===sqlName and mode is the default, so neither is used
		// here.
		const searchPosts = defineFunction(
			app,
			"search_posts",
			{ args: { postStatus: text() }, returns: posts },
			(ctx, args) => {
				ctx.return(
					select(posts).where(sql`${posts.title} = ${args.postStatus}`),
				);
			},
		);
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ args: { minWeight: bigint({ mode: "number" }) }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			posts,
			searchPosts,
			totalPosts,
		];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[searchPosts, "searchPosts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);
		const source = emitContract(payload, ORIGIN);

		// The Database interface's own Functions section.
		expect(source).toContain('"searchPosts": {');
		expect(source).toContain("readonly postStatus: string;");
		expect(source).toContain(
			'readonly Returns: ReadonlyArray<Database["Tables"]["posts"]["Row"]>;',
		);
		expect(source).toContain('"totalPosts": {');
		expect(source).toContain("readonly minWeight: number;");
		expect(source).toContain("readonly Returns: bigint;");

		// The runtime metadata's own functions map.
		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('"searchPosts": {');
		expect(metadataBlock).toContain('key: "postStatus"');
		expect(metadataBlock).toContain('sqlName: "post_status"');
		expect(metadataBlock).toContain('"totalPosts": {');
		expect(metadataBlock).toContain('mode: "number"');
	});

	it("a function with no arguments emits Record<string, never>, not {}", () => {
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, totalPosts];
		const payload = buildFixturePayload(
			declarations,
			new Map([[totalPosts, "totalPosts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Args: Record<string, never>;");
	});

	it("an empty Functions section renders as {}, distinct from Views' own marker", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
	});

	it("a trigger-synthesized function is absent", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		const trigger = defineTrigger(
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
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, trigger];
		const payload = buildFixturePayload(
			declarations,
			new Map([[posts, "posts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
		expect(source).not.toContain("posts_touch");
	});

	it("a function returning a table the contract does not carry is absent", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const authorPosts = defineFunction(
			app,
			"author_posts",
			{ returns: authors },
			(ctx) => {
				ctx.return(select(authors));
			},
		);
		// Only `app` and `authorPosts` reach generation -- `authors` never
		// reaches the snapshot, the same pattern "no relation is derived for
		// an unmanaged target" above uses for a foreign key's target.
		const declarations: ReadonlyArray<HejbroInput> = [app, authorPosts];
		const payload = buildFixturePayload(
			declarations,
			new Map([[authorPosts, "authorPosts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
		expect(source).not.toContain("authorPosts");
	});

	it("two runs against one commit are byte-identical with a function declared", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ args: { minWeight: bigint({ mode: "number" }) }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, totalPosts];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const first = emitContract(payload, ORIGIN);
		const second = emitContract(payload, ORIGIN);

		expect(first).toBe(second);
	});
});
