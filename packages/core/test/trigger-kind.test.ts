import { describe, expect, it } from "vitest";
import {
	createDefaultRegistry,
	defineTrigger,
	emptySnapshot,
	generateMigration,
	schema,
	table,
	triggerKind,
	uuid,
} from "../src/index";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});

const makeTrigger = (timing: "before" | "after") =>
	defineTrigger(
		comments,
		{
			name: "comments_single_depth",
			timing,
			events: ["insert"],
			forEach: "row",
		},
		(ctx, { new: row }) => {
			ctx.return(row);
		},
	);

describe("triggerKind", () => {
	it("serializes the expected shape", () => {
		const declaration = makeTrigger("before");
		const snapshot = triggerKind.serialize(declaration) as {
			schema: string;
			table: string;
			name: string;
			timing: string;
			events: ReadonlyArray<unknown>;
			forEach: string;
			function: string;
		};
		expect(snapshot).toEqual({
			schema: "app",
			table: "comments",
			name: "comments_single_depth",
			timing: "before",
			events: [{ event: "insert" }],
			forEach: "row",
			function: "comments_single_depth_fn",
		});
	});

	it("identifies as schema.table.name", () => {
		const snapshot = triggerKind.serialize(makeTrigger("before"));
		expect(triggerKind.identify(snapshot)).toBe(
			"app.comments.comments_single_depth",
		);
	});

	it("diffs create when there is no previous snapshot", () => {
		const next = triggerKind.serialize(makeTrigger("before"));
		const identity = "app.comments.comments_single_depth";
		expect(triggerKind.diff(null, next, identity)).toEqual([
			{
				kind: "trigger",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = triggerKind.serialize(makeTrigger("before"));
		const identity = "app.comments.comments_single_depth";
		expect(triggerKind.diff(previous, null, identity)).toEqual([
			{
				kind: "trigger",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical declarations", () => {
		const previous = triggerKind.serialize(makeTrigger("before"));
		const next = triggerKind.serialize(makeTrigger("before"));
		const identity = "app.comments.comments_single_depth";
		expect(triggerKind.diff(previous, next, identity)).toEqual([]);
	});

	it("diffs any field change as a single alter with a trigger-changed note", () => {
		const previous = triggerKind.serialize(makeTrigger("before"));
		const next = triggerKind.serialize(makeTrigger("after"));
		const identity = "app.comments.comments_single_depth";
		expect(triggerKind.diff(previous, next, identity)).toEqual([
			{
				kind: "trigger",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["trigger changed; recreating"],
			},
		]);
	});

	it("emits drop-if-exists + create, in that order, for a create change", () => {
		const next = triggerKind.serialize(makeTrigger("before"));
		const statements = triggerKind.emit({
			kind: "trigger",
			operation: "create",
			identity: "app.comments.comments_single_depth",
			previous: null,
			next,
			notes: [],
		});
		expect(statements).toHaveLength(2);
		expect(statements[0]?.sql).toContain("drop trigger if exists");
		expect(statements[1]?.sql).toContain("create trigger");
	});

	it("emits drop-if-exists + create, in that order, for an alter change", () => {
		const previous = triggerKind.serialize(makeTrigger("before"));
		const next = triggerKind.serialize(makeTrigger("after"));
		const statements = triggerKind.emit({
			kind: "trigger",
			operation: "alter",
			identity: "app.comments.comments_single_depth",
			previous,
			next,
			notes: ["trigger changed; recreating"],
		});
		expect(statements).toHaveLength(2);
		expect(statements[0]?.sql).toContain("drop trigger if exists");
		expect(statements[1]?.sql).toContain("create trigger");
		expect(statements[1]?.sql).toContain("after");
	});

	it("emits only drop-if-exists for a drop change", () => {
		const previous = triggerKind.serialize(makeTrigger("before"));
		const statements = triggerKind.emit({
			kind: "trigger",
			operation: "drop",
			identity: "app.comments.comments_single_depth",
			previous,
			next: null,
			notes: [],
		});
		expect(statements).toHaveLength(1);
		expect(statements[0]?.sql).toContain("drop trigger if exists");
	});

	it("is registered by createDefaultRegistry, depending on function and table", () => {
		const registry = createDefaultRegistry();
		expect(registry.get("trigger")).toBe(triggerKind);
		expect(triggerKind.dependsOn).toEqual(["function", "table"]);
	});

	it("generateMigration expands a trigger input and creates the function before the trigger", () => {
		const trigger = makeTrigger("before");
		const result = generateMigration({
			declarations: [comments, trigger],
			previousSnapshot: emptySnapshot,
		});
		const functionIndex = result.sql.indexOf(
			'create or replace function "app"."comments_single_depth_fn"',
		);
		const triggerIndex = result.sql.indexOf(
			'create trigger "comments_single_depth"',
		);
		expect(functionIndex).toBeGreaterThanOrEqual(0);
		expect(triggerIndex).toBeGreaterThan(functionIndex);
	});
});
