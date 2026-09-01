import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	defineTrigger,
	defineView,
	grant,
	literal,
	rls,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import {
	buildExportDescription,
	serializeExportDescription,
} from "../src/export/description";

const app = schema("app");

describe("buildExportDescription", () => {
	it("every declaration-time choice is recovered", () => {
		const users = table(app, "users", {
			userId: uuid().primaryKey(),
		});
		// Column order is alphabetical (amount, id, tags) on purpose: this
		// fixture is a control for "keys every column fact by the column's
		// SQL name, not its position" below — a position-based join mutant
		// only misattributes facts when declaration order and sorted order
		// disagree, so this fixture must not (by coincidence or otherwise)
		// be a differing-order case itself.
		const posts = table(
			app,
			"posts",
			{
				amount: bigint({ mode: "bigint" }).notNull(),
				id: uuid().primaryKey(),
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

		const description = buildExportDescription(declarations, exportNames);

		const postsFact = description.tables.find((t) => t.tableName === "posts");
		expect(postsFact).toMatchObject({
			schemaName: "app",
			tableName: "posts",
			exportName: "posts",
		});
		expect(postsFact?.columns).toEqual({
			id: { key: "id", mode: null, notNullElements: false },
			amount: { key: "amount", mode: "bigint", notNullElements: false },
			tags: { key: "tags", mode: null, notNullElements: true },
		});

		const functionFact = description.functions.find(
			(f) => f.functionName === "total_posts",
		);
		expect(functionFact).toEqual({
			schemaName: "app",
			functionName: "total_posts",
			exportName: "totalPosts",
		});

		expect(description.roles).toEqual(["anon", "authenticated"]);
	});

	it("carries roles sorted, not in declaration order", () => {
		const zebraGrant = grant(app).usage.to("zebra");
		const appleGrant = grant(app).usage.to("apple");

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			zebraGrant,
			appleGrant,
		];

		const description = buildExportDescription(declarations, new Map());
		expect(description.roles).toEqual(["apple", "zebra"]);
	});

	it("a trigger's function carries no export name", () => {
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

		const description = buildExportDescription(declarations, exportNames);

		const triggerFunctionFact = description.functions.find(
			(f) => f.functionName === trigger.functionDeclaration.functionName,
		);
		expect(triggerFunctionFact).toBeDefined();
		expect(triggerFunctionFact?.exportName).toBeNull();
	});

	it("a brand is not among the carried facts", () => {
		const branded = table(app, "widgets", {
			id: uuid().primaryKey(),
			metadata: text().$type<"note">(),
		});
		const plain = table(app, "gadgets", {
			id: uuid().primaryKey(),
			metadata: text(),
		});

		const brandedFact = buildExportDescription([app, branded], new Map())
			.tables[0];
		const plainFact = buildExportDescription([app, plain], new Map()).tables[0];

		expect(brandedFact?.columns.metadata).toEqual(plainFact?.columns.metadata);
	});

	it("facts follow the column's name, not its position", () => {
		// Control: declaration order already matches sorted (stand-in
		// physical) order, so a position-based join would coincidentally
		// still read correctly here — this fixture alone can't tell the two
		// implementations apart.
		const ordered = table(app, "widgets", {
			aa: uuid().primaryKey(),
			bb: text().array().notNullElements(),
		});
		// Differing: simulates a column dropped and re-added (D81 moves a
		// re-added column to the end of physical order) — "title" is
		// declared before "id" here, so a join keyed by array position
		// against a differently-ordered list would attach "id"'s facts to
		// "title" and vice versa, even though every value still type-checks.
		const reordered = table(app, "posts", {
			title: text().array().notNullElements(),
			id: uuid().primaryKey(),
		});

		const orderedFact = buildExportDescription([app, ordered], new Map())
			.tables[0];
		const reorderedFact = buildExportDescription([app, reordered], new Map())
			.tables[0];

		expect(orderedFact?.columns.aa).toEqual({
			key: "aa",
			mode: null,
			notNullElements: false,
		});
		expect(orderedFact?.columns.bb).toEqual({
			key: "bb",
			mode: null,
			notNullElements: true,
		});
		expect(reorderedFact?.columns.id).toEqual({
			key: "id",
			mode: null,
			notNullElements: false,
		});
		expect(reorderedFact?.columns.title).toEqual({
			key: "title",
			mode: null,
			notNullElements: true,
		});
	});

	it("the export states what it does not carry", () => {
		// A view and a function with a typed argument, together: the export
		// has never had a branch for either's extra shape (R2-G2 2.8's own
		// boundary decision) — a view yields no fact at all, and a
		// function's fact carries only its names, never an argument.
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			status: text().notNull(),
		});
		const openPosts = defineView(app, "open_posts", select(posts));
		const postsByStatus = defineFunction(
			app,
			"posts_by_status",
			{ args: { status: text() }, returns: posts },
			(ctx, args) => {
				ctx.return(select(posts).where(sql`${posts.status} = ${args.status}`));
			},
		);

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			posts,
			openPosts,
			postsByStatus,
		];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[postsByStatus, "postsByStatus"],
		]);

		const description = buildExportDescription(declarations, exportNames);

		expect(description.tables.some((t) => t.tableName === "open_posts")).toBe(
			false,
		);
		expect(description.tables).toHaveLength(1);

		const functionFact = description.functions.find(
			(f) => f.functionName === "posts_by_status",
		);
		expect(functionFact).toEqual({
			schemaName: "app",
			functionName: "posts_by_status",
			exportName: "postsByStatus",
		});
		expect(functionFact).not.toHaveProperty("args");
	});
});

describe("serializeExportDescription", () => {
	it("serializes with the snapshot's own stable serialization", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
		});
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const description = buildExportDescription(declarations, exportNames);

		const first = serializeExportDescription(description);
		const second = serializeExportDescription(description);
		expect(first).toBe(second);
		// tab-indented, sorted-key JSON with a trailing newline — stableJson's
		// own signature, not a second, ad hoc serialization rule.
		expect(first.endsWith("\n")).toBe(true);
		expect(first).toContain('\t"tables"');
		expect(JSON.parse(first)).toEqual(description);
	});
});
