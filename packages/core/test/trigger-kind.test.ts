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

	// D75: an alter's own drop half is bare, not `if exists` -- only a
	// true first-time create keeps the idempotent guard text (below).
	it("emits a bare drop + create, in that order, for an alter change", () => {
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
		expect(statements[0]?.sql).toContain("drop trigger ");
		expect(statements[0]?.sql).not.toContain("if exists");
		expect(statements[1]?.sql).toContain("create trigger");
		expect(statements[1]?.sql).toContain("after");
	});

	it("emits only a bare drop for a drop change", () => {
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
		expect(statements[0]?.sql).toContain("drop trigger ");
		expect(statements[0]?.sql).not.toContain("if exists");
	});

	it("is registered by createDefaultRegistry, depending on function and table", () => {
		const registry = createDefaultRegistry();
		expect(registry.get("trigger")).toBe(triggerKind);
		expect(triggerKind.dependsOn).toEqual(["function", "table"]);
	});

	// #701/D3: events (and an update event's own column list) are
	// set-shaped -- the database never reads their declared order, so two
	// declarations listing the same members in a different order must
	// serialize to byte-identical nodes, produce no diff, and render
	// `create trigger … after …` in the one canonical order (insert,
	// update, delete; an `update of` column list sorted by name). The
	// control rows pin that a real membership change still reports the
	// existing alter.
	describe("triggerKind — canonical order of events (#701)", () => {
		const buildTrigger = (
			events: ReadonlyArray<
				| { readonly event: "insert" }
				| { readonly event: "delete" }
				| {
						readonly event: "update";
						readonly columns: ReadonlyArray<string> | null;
				  }
			>,
			// A hand-built TriggerSnapshot node (not triggerKind.serialize), the
			// same way table-kind-diff.test.ts's index snapshot accessor tests
			// build IndexSnapshot fixtures directly -- a real TriggerDeclaration
			// also needs a full FunctionDeclaration this scenario has no use for,
			// and triggerKind.serialize only ever copies `events` through as-is.
		) => ({
			schema: "app",
			table: "comments",
			name: "comments_single_depth",
			timing: "before" as const,
			events,
			forEach: "row" as const,
			function: "comments_single_depth_fn",
		});

		it.each([
			{
				name: "update/insert swapped",
				eventsA: [
					{ event: "update" as const, columns: null },
					{ event: "insert" as const },
				],
				eventsB: [
					{ event: "insert" as const },
					{ event: "update" as const, columns: null },
				],
			},
			{
				name: "delete/insert/update reordered to the fixed rank",
				eventsA: [
					{ event: "delete" as const },
					{ event: "insert" as const },
					{ event: "update" as const, columns: null },
				],
				eventsB: [
					{ event: "insert" as const },
					{ event: "update" as const, columns: null },
					{ event: "delete" as const },
				],
			},
			{
				name: "update of columns b,a vs a,b",
				eventsA: [{ event: "update" as const, columns: ["b", "a"] }],
				eventsB: [{ event: "update" as const, columns: ["a", "b"] }],
			},
		])("$name: byte-identical, no diff", ({ eventsA, eventsB }) => {
			const previous = buildTrigger(eventsA);
			const next = buildTrigger(eventsB);
			const identity = "app.comments.comments_single_depth";
			expect(triggerKind.canonicalize?.(previous)).toEqual(
				triggerKind.canonicalize?.(next),
			);
			expect(
				triggerKind.diff(
					triggerKind.canonicalize?.(previous) ?? previous,
					triggerKind.canonicalize?.(next) ?? next,
					identity,
				),
			).toEqual([]);
		});

		it("control: an event added is still a reported alter", () => {
			const previous =
				triggerKind.canonicalize?.(buildTrigger([{ event: "insert" }])) ?? null;
			const next =
				triggerKind.canonicalize?.(
					buildTrigger([
						{ event: "insert" },
						{ event: "update", columns: null },
					]),
				) ?? null;
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

		it("control: a column added to update of is still a reported alter", () => {
			const previous =
				triggerKind.canonicalize?.(
					buildTrigger([{ event: "update", columns: ["a"] }]),
				) ?? null;
			const next =
				triggerKind.canonicalize?.(
					buildTrigger([{ event: "update", columns: ["a", "b"] }]),
				) ?? null;
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

		it("renders create trigger … after … in canonical event order, update of columns sorted", () => {
			const next = triggerKind.canonicalize?.(
				buildTrigger([
					{ event: "update", columns: ["title", "id"] },
					{ event: "delete" },
					{ event: "insert" },
				]),
			);
			const statements = triggerKind.emit({
				kind: "trigger",
				operation: "create",
				identity: "app.comments.comments_single_depth",
				previous: null,
				next: next ?? null,
				notes: [],
			});
			expect(statements[1]?.sql).toContain(
				'insert or update of "id", "title" or delete',
			);
		});
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
