import { describe, expect, it } from "vitest";
import {
	buildSnapshot,
	createDefaultRegistry,
	defineFunction,
	defineTrigger,
	generateMigration,
	getTableMeta,
	pgEnum,
	schema,
	select,
	table,
	uuid,
} from "../src/index";

// Regression coverage for a same-identity recreate (drop+create) landing in
// the wrong order in the emitted SQL — `diffSnapshots` buckets all
// creates/alters before all drops, so a naive two-change recreate (one
// "drop" + one "create" for the same identity) had its create hoisted
// before its drop. Only end-to-end `generateMigration` runs exercise the
// real ordering; a kind's own diff()/emit() unit tests don't.

const app = schema("app");
const registry = createDefaultRegistry();

describe("recreate ordering through generateMigration", () => {
	it("a trigger definition change drops before it creates, ending on create", () => {
		const comments = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
			parentId: uuid(),
		});

		const triggerV1 = defineTrigger(
			comments,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const previousSnapshot = buildSnapshot(
			[getTableMeta(comments), triggerV1.functionDeclaration, triggerV1],
			registry,
		);

		const triggerV2 = defineTrigger(
			comments,
			{
				name: "guard",
				timing: "before",
				events: [{ update: ["parentId"] }],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);

		const result = generateMigration({
			declarations: [comments, triggerV2],
			previousSnapshot,
			registry,
		});

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "trigger",
			operation: "alter",
		});

		const dropIndex = result.sql.indexOf(
			'drop trigger if exists "guard" on "app"."comments";',
		);
		const createIndex = result.sql.indexOf('create trigger "guard"');
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result.sql.trimEnd().endsWith(");")).toBe(true);
	});

	it("a function security-only change drops the old signature before creating the new one", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });

		const functionV1 = defineFunction(
			"app",
			"publish_post",
			{ args: { postId: uuid() }, returns: posts, security: "invoker" },
			(ctx) => {
				ctx.return(select(posts));
			},
		);
		const previousSnapshot = buildSnapshot([functionV1], registry);

		const functionV2 = defineFunction(
			"app",
			"publish_post",
			{ args: { postId: uuid() }, returns: posts, security: "definer" },
			(ctx) => {
				ctx.return(select(posts));
			},
		);

		const result = generateMigration({
			declarations: [functionV2],
			previousSnapshot,
			registry,
		});

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "function",
			operation: "alter",
		});

		const dropIndex = result.sql.indexOf(
			'drop function "app"."publish_post"(uuid);',
		);
		const createIndex = result.sql.indexOf(
			'create or replace function "app"."publish_post"',
		);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
		expect(result.sql).toContain("security definer");
	});

	it("removing an enum value drops the type before recreating it", () => {
		const statusV1 = pgEnum(app, "post_status", ["draft", "published"]);
		const previousSnapshot = buildSnapshot([statusV1], registry);

		const statusV2 = pgEnum(app, "post_status", ["draft"]);
		const result = generateMigration({
			declarations: [statusV2],
			previousSnapshot,
			registry,
		});

		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({
			kind: "enum",
			operation: "alter",
		});

		const dropIndex = result.sql.indexOf('drop type "app"."post_status";');
		const createIndex = result.sql.indexOf('create type "app"."post_status"');
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBeGreaterThan(dropIndex);
	});
});
