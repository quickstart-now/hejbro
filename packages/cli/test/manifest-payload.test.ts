import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	defineTrigger,
	grant,
	literal,
	rls,
	schema,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import {
	buildManifestPayload,
	serializeManifestPayload,
} from "../src/manifest-payload";

const app = schema("app");

describe("buildManifestPayload", () => {
	it("collects mode, non-null elements, TypeScript keys, table and function export names, and roles", () => {
		const users = table(app, "users", {
			userId: uuid().primaryKey(),
		});
		const posts = table(
			app,
			"posts",
			{
				id: uuid().primaryKey(),
				amount: bigint({ mode: "bigint" }).notNull(),
				tags: text().array().notNullElements(),
			},
			() => ({
				rls: rls.enabled({
					read: rls
						.policy("p")
						.for("select")
						.to("authenticated")
						.using(literal(true)),
				}),
			}),
		);
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const grantSet = grant(app).usage.to("anon");

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			users,
			posts,
			totalPosts,
			grantSet,
		];
		const exportNames = new Map<HejbroInput, string>([
			[users, "users"],
			[posts, "posts"],
			[totalPosts, "totalPosts"],
		]);

		const payload = buildManifestPayload(declarations, exportNames);

		const postsFact = payload.tables.find((t) => t.tableName === "posts");
		expect(postsFact).toMatchObject({
			schemaName: "app",
			tableName: "posts",
			exportName: "posts",
		});
		expect(postsFact?.columns).toEqual([
			{ columnKey: "id", mode: null, notNullElements: false },
			{ columnKey: "amount", mode: "bigint", notNullElements: false },
			{ columnKey: "tags", mode: null, notNullElements: true },
		]);

		const functionFact = payload.functions.find(
			(f) => f.functionName === "total_posts",
		);
		expect(functionFact).toEqual({
			schemaName: "app",
			functionName: "total_posts",
			exportName: "totalPosts",
		});

		expect(payload.roles).toEqual(["anon", "authenticated"]);
	});

	it("carries roles sorted, not in declaration order (G5's byte-identical-sync SHALL rests on this)", () => {
		const zebraGrant = grant(app).usage.to("zebra");
		const appleGrant = grant(app).usage.to("apple");

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			zebraGrant,
			appleGrant,
		];

		const payload = buildManifestPayload(declarations, new Map());
		expect(payload.roles).toEqual(["apple", "zebra"]);
	});

	it("carries no export name for a trigger-synthesized function", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
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
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);

		const payload = buildManifestPayload(declarations, exportNames);

		const triggerFunctionFact = payload.functions.find(
			(f) => f.functionName === trigger.functionDeclaration.functionName,
		);
		expect(triggerFunctionFact).toBeDefined();
		expect(triggerFunctionFact?.exportName).toBeNull();
	});

	it("carries no brand information", () => {
		const branded = table(app, "widgets", {
			id: uuid().primaryKey(),
			metadata: text().$type<"note">(),
		});
		const plain = table(app, "gadgets", {
			id: uuid().primaryKey(),
			metadata: text(),
		});

		const brandedFact = buildManifestPayload([app, branded], new Map())
			.tables[0];
		const plainFact = buildManifestPayload([app, plain], new Map()).tables[0];

		expect(
			brandedFact?.columns.find((c) => c.columnKey === "metadata"),
		).toEqual(plainFact?.columns.find((c) => c.columnKey === "metadata"));
	});
});

describe("serializeManifestPayload", () => {
	it("serializes with the snapshot's own stable serialization", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const payload = buildManifestPayload(declarations, exportNames);

		const first = serializeManifestPayload(payload);
		const second = serializeManifestPayload(payload);
		expect(first).toBe(second);
		// tab-indented, sorted-key JSON with a trailing newline — stableJson's
		// own signature, not a second, ad hoc serialization rule.
		expect(first.endsWith("\n")).toBe(true);
		expect(first).toContain('\t"tables"');
		expect(JSON.parse(first)).toEqual(payload);
	});
});
