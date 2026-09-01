import { eq, schema, select, table, text, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { compile } from "../../src/compile/compile";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
};

const METADATA: ContractMetadata = {
	commit: "abc123",
	exportHash: "sha256:x",
	roles: [],
	tables: {
		posts: {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				title: {
					sqlName: "title",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
};

/**
 * The compiled SQL equals what the declaration-based path compiles for
 * the same query (R2-G6 6.5) — this group's own real proof, per the
 * planner's own emphasis: without it, a client could be "typed right but
 * wired to different SQL". Two scenarios, both through
 * `createNameKeyedDb` itself (the real wrapper, not a lower internal
 * seam): a plain whole-table select, and — since owner seal (가) opened
 * `.where(eq(...))` on the public surface — a filtered one, which is
 * where this design's real reuse claim lives (the planner's own note:
 * comparing only the unfiltered case would leave the biggest reused
 * surface unverified).
 */
describe("the compiled SQL equals the declaration-based path (R2-G6 6.5)", () => {
	it("a plain select compiles to the same SQL and params", () => {
		const app = schema("app");
		const declaredPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declaredCompiled = compile(select(declaredPosts));

		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const clientCompiled = client.posts.select().compile();

		expect(clientCompiled.sql).toBe(declaredCompiled.sql);
		expect(clientCompiled.params).toEqual(declaredCompiled.params);
	});

	it("a filtered select (owner seal (가), .where(eq(...))) compiles to the same SQL and params", () => {
		const app = schema("app");
		const declaredPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declaredCompiled = compile(
			select(declaredPosts).where(eq(declaredPosts.id, "p1")),
		);

		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const clientCompiled = client.posts
			.select()
			.where(eq(client.posts.columns.id, "p1"))
			.compile();

		expect(clientCompiled.sql).toBe(declaredCompiled.sql);
		expect(clientCompiled.params).toEqual(declaredCompiled.params);
	});
});
