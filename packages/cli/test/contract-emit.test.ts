import type { HejbroInput } from "@hejbro/core";
import { schema, table, text, uuid } from "@hejbro/core";
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
