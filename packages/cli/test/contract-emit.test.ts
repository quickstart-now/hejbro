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

		expect(source).toContain("export const createDb = (conn: unknown)");
		// No generic reaches the caller (proposal.md, "no type parameter
		// reaches the user") -- the only angle bracket in the factory's own
		// signature line would be a generic parameter list, and there is
		// none.
		const factoryLine =
			source
				.split("\n")
				.find((line) => line.startsWith("export const createDb")) ?? "";
		expect(factoryLine).not.toContain("<");
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
