import {
	bigint,
	defineFunction,
	eq,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
	readonly Functions: Record<string, never>;
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
	functions: {},
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

type FnTestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
	readonly Functions: {
		readonly totalPosts: {
			readonly Args: { readonly minWeight: number };
			readonly Returns: number;
		};
		readonly postById: {
			readonly Args: { readonly postId: string };
			readonly Returns: ReadonlyArray<{
				readonly id: string;
				readonly title: string;
			}>;
		};
	};
};

const FN_METADATA: ContractMetadata = {
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
	functions: {
		totalPosts: {
			schema: "app",
			name: "total_posts",
			args: [
				{
					key: "minWeight",
					sqlName: "min_weight",
					typeNode: { typeName: "bigint" },
					mode: "number",
					notNullElements: false,
				},
			],
			returns: {
				kind: "scalar",
				typeNode: { typeName: "bigint" },
				mode: "number",
			},
		},
		postById: {
			schema: "app",
			name: "post_by_id",
			args: [
				{
					key: "postId",
					sqlName: "post_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			],
			returns: { kind: "table", schema: "app", name: "posts" },
		},
	},
};

/**
 * `fn`'s own SQL parity (#587/G3) — the function sibling of R2-G6 6.5's
 * table parity above, and a distinct claim from it (a mismatched-column
 * type test, or a table-parity green, says nothing about whether `fn`
 * renders through the same call plan `db.fn` does). No `.compile()` on
 * `FnCaller` (unlike a select chain), so this compares what the
 * recording driver actually received — the real proof, not a rendered-
 * but-unsent string.
 */
describe("db.fn's SQL equals the vendored fn's SQL (#587/G3)", () => {
	it("a scalar-returning call sends the same SQL and params", async () => {
		const app = schema("app");
		const declaredPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{
				args: { minWeight: bigint({ mode: "number" }) },
				returns: bigint({ mode: "number" }),
			},
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const { driver: declaredDriver, topLevelSent: declaredSent } =
			recordingTransactionalDriver({ rows: [{ result: "42" }] });
		const declaredHandle = db(
			{ posts: declaredPosts, totalPosts },
			declaredDriver,
		);
		await declaredHandle.fn.totalPosts({ minWeight: 5 });

		const { driver: clientDriver, topLevelSent: clientSent } =
			recordingTransactionalDriver({ rows: [{ result: "42" }] });
		const client = createNameKeyedDb<FnTestDatabase>(clientDriver, FN_METADATA);
		await client.fn.totalPosts({ minWeight: 5 });

		expect(clientSent[0]?.sql).toBe(declaredSent[0]?.sql);
		expect(clientSent[0]?.params).toEqual(declaredSent[0]?.params);
	});

	it("a table-returning call sends the same SQL and params, with an explicit column list", async () => {
		const app = schema("app");
		const declaredPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const postById = defineFunction(
			app,
			"post_by_id",
			{ args: { postId: uuid() }, returns: declaredPosts },
			(ctx, args) => {
				ctx.return(
					select(declaredPosts).where(eq(declaredPosts.id, args.postId)),
				);
			},
		);
		const rawRow = {
			id: "11111111-1111-1111-1111-111111111111",
			title: "hello",
		};
		const { driver: declaredDriver, topLevelSent: declaredSent } =
			recordingTransactionalDriver({ rows: [rawRow] });
		const declaredHandle = db(
			{ posts: declaredPosts, postById },
			declaredDriver,
		);
		await declaredHandle.fn.postById({ postId: "p1" });

		const { driver: clientDriver, topLevelSent: clientSent } =
			recordingTransactionalDriver({ rows: [rawRow] });
		const client = createNameKeyedDb<FnTestDatabase>(clientDriver, FN_METADATA);
		await client.fn.postById({ postId: "p1" });

		expect(clientSent[0]?.sql).toBe(declaredSent[0]?.sql);
		expect(clientSent[0]?.sql).toContain('select "id", "title" from');
		expect(clientSent[0]?.params).toEqual(declaredSent[0]?.params);
	});
});
