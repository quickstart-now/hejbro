import { describe, expect, it } from "vitest";
import {
	buildSnapshot,
	createDefaultRegistry,
	defineFunction,
	defineTrigger,
	defineView,
	emptySnapshot,
	generateMigration,
	getTableMeta,
	isNotNull,
	isNull,
	pgEnum,
	rls,
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

		// D75: an alter's own drop half is bare, not `if exists`.
		const dropIndex = result.sql.indexOf(
			'drop trigger "guard" on "app"."comments";',
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

	// #122: a view/trigger/policy can reference a column that a *different*
	// kind change — a table alter — drops in the same run. The diff engine's
	// ascending create/alter ordering put the table's `drop column` before
	// the dependent object's own recreate, so Postgres rejected the column
	// drop ("other objects depend on it"). These three cases pin the fix:
	// the dependent object's drop half must land on the `predrop` stage,
	// ahead of every `main`-stage statement.

	it("a view depending on a dropped column drops before the table alters, ending on create", () => {
		const tasksV1 = table(app, "tasks", {
			id: uuid().primaryKey(),
			dueAt: uuid(),
			title: uuid().notNull(),
		});
		const openTasksV1 = defineView(app, "open_tasks", select(tasksV1));
		const initial = generateMigration({
			declarations: [tasksV1, openTasksV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const tasksV2 = table(app, "tasks", {
			id: uuid().primaryKey(),
			title: uuid().notNull(),
		});
		const openTasksV2 = defineView(app, "open_tasks", select(tasksV2));

		const result = generateMigration({
			declarations: [tasksV2, openTasksV2],
			previousSnapshot: initial.snapshot,
			registry,
		});

		const dropViewIndex = result.sql.indexOf(
			'drop view if exists "app"."open_tasks";',
		);
		const dropColumnIndex = result.sql.indexOf('drop column "due_at"');
		const createViewIndex = result.sql.indexOf(
			'create or replace view "app"."open_tasks"',
		);
		expect(dropViewIndex).toBeGreaterThanOrEqual(0);
		expect(dropColumnIndex).toBeGreaterThan(dropViewIndex);
		expect(createViewIndex).toBeGreaterThan(dropColumnIndex);
	});

	it("a trigger watching a dropped column drops before the table alters, ending on create", () => {
		const commentsV1 = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
			watchedAt: uuid(),
		});
		const triggerV1 = defineTrigger(
			commentsV1,
			{
				name: "guard",
				timing: "before",
				events: ["insert", { update: ["watchedAt"] }],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const initial = generateMigration({
			declarations: [commentsV1, triggerV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const commentsV2 = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
		});
		const triggerV2 = defineTrigger(
			commentsV2,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);

		const result = generateMigration({
			declarations: [commentsV2, triggerV2],
			previousSnapshot: initial.snapshot,
			registry,
		});

		// D75: an alter's own drop half is bare, not `if exists`.
		const dropTriggerIndex = result.sql.indexOf(
			'drop trigger "guard" on "app"."comments";',
		);
		const dropColumnIndex = result.sql.indexOf('drop column "watched_at"');
		const createTriggerIndex = result.sql.indexOf('create trigger "guard"');
		expect(dropTriggerIndex).toBeGreaterThanOrEqual(0);
		expect(dropColumnIndex).toBeGreaterThan(dropTriggerIndex);
		expect(createTriggerIndex).toBeGreaterThan(dropColumnIndex);
	});

	it("a policy depending on a dropped column drops before the table alters, ending on create", () => {
		const membersV1 = table(
			app,
			"members",
			{ id: uuid().primaryKey(), suspendedAt: uuid() },
			(t) => ({
				rls: rls.enabled({
					readAll: rls
						.policy("members_read_all")
						.for("select")
						.to("reader")
						.using(isNull(t.suspendedAt)),
				}),
			}),
		);
		const initial = generateMigration({
			declarations: [membersV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const membersV2 = table(
			app,
			"members",
			{ id: uuid().primaryKey() },
			(t) => ({
				rls: rls.enabled({
					readAll: rls
						.policy("members_read_all")
						.for("select")
						.to("reader")
						.using(isNotNull(t.id)),
				}),
			}),
		);

		const result = generateMigration({
			declarations: [membersV2],
			previousSnapshot: initial.snapshot,
			registry,
		});

		// D75: an alter's own drop half is bare, not `if exists`.
		const dropPolicyIndex = result.sql.indexOf(
			'drop policy "members_read_all" on "app"."members";',
		);
		const dropColumnIndex = result.sql.indexOf('drop column "suspended_at"');
		const createPolicyIndex = result.sql.indexOf(
			'create policy "members_read_all"',
		);
		expect(dropPolicyIndex).toBeGreaterThanOrEqual(0);
		expect(dropColumnIndex).toBeGreaterThan(dropPolicyIndex);
		expect(createPolicyIndex).toBeGreaterThan(dropColumnIndex);
	});

	it("a trigger's first-time create keeps its idempotent drop immediately before its own create (predrop is alter/drop only, A′)", () => {
		const comments = table(app, "comments", {
			id: uuid().primaryKey(),
			postId: uuid().notNull(),
		});
		const trigger = defineTrigger(
			comments,
			{ name: "guard", timing: "before", events: ["insert"], forEach: "row" },
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);

		const result = generateMigration({
			declarations: [comments, trigger],
			previousSnapshot: emptySnapshot,
			registry,
		});

		expect(result.changes).toContainEqual(
			expect.objectContaining({ kind: "trigger", operation: "create" }),
		);

		const dropStatement = 'drop trigger if exists "guard" on "app"."comments";';
		const createStatementStart = 'create trigger "guard"';
		const dropIndex = result.sql.indexOf(dropStatement);
		expect(dropIndex).toBeGreaterThanOrEqual(0);
		// adjacent (joined by the SQL assembler's own "\n\n") — proves both
		// halves stayed in the same stage, back to back, not split by an
		// intervening predrop or main group.
		const afterDrop = result.sql.slice(dropIndex + dropStatement.length);
		expect(afterDrop.startsWith(`\n\n${createStatementStart}`)).toBe(true);
	});

	it("assembles predrop, then main, then deferred, in that order", () => {
		const tasksV1 = table(app, "tasks", {
			id: uuid().primaryKey(),
			dueAt: uuid(),
		});
		const openTasksV1 = defineView(app, "open_tasks", select(tasksV1));
		const initial = generateMigration({
			declarations: [tasksV1, openTasksV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		const tasksV2 = table(app, "tasks", { id: uuid().primaryKey() });
		const openTasksV2 = defineView(app, "open_tasks", select(tasksV2));
		const projects = table(
			app,
			"projects",
			{ id: uuid().primaryKey(), taskId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.taskId],
						references: { table: tasksV2, columns: [tasksV2.id] },
					},
				],
			}),
		);

		const result = generateMigration({
			declarations: [tasksV2, openTasksV2, projects],
			previousSnapshot: initial.snapshot,
			registry,
		});

		const predropIndex = result.sql.indexOf(
			'drop view if exists "app"."open_tasks";',
		);
		const mainIndex = result.sql.indexOf('create table "app"."projects"');
		const deferredIndex = result.sql.indexOf(
			'add constraint "projects_task_id_fk"',
		);
		expect(predropIndex).toBeGreaterThanOrEqual(0);
		expect(mainIndex).toBeGreaterThan(predropIndex);
		expect(deferredIndex).toBeGreaterThan(mainIndex);
	});

	it("a cross-table foreign key drops before the column it references, even though the referenced table sorts first by identity", () => {
		const membersV1 = table(app, "members", {
			id: uuid().primaryKey(),
			email: uuid().notNull().unique(),
		});
		const projectsV1 = table(
			app,
			"projects",
			{ id: uuid().primaryKey(), ownerEmail: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.ownerEmail],
						references: { table: membersV1, columns: [membersV1.email] },
					},
				],
			}),
		);
		const initial = generateMigration({
			declarations: [membersV1, projectsV1],
			previousSnapshot: emptySnapshot,
			registry,
		});

		// "app.members" sorts before "app.projects" by identity — without the
		// fix, members' column drop (main) lands ahead of projects' constraint
		// drop (also main, pre-fix), and Postgres rejects it.
		const membersV2 = table(app, "members", { id: uuid().primaryKey() });
		const projectsV2 = table(app, "projects", {
			id: uuid().primaryKey(),
			ownerEmail: uuid().notNull(),
		});

		const result = generateMigration({
			declarations: [membersV2, projectsV2],
			previousSnapshot: initial.snapshot,
			registry,
		});

		const dropConstraintIndex = result.sql.indexOf(
			'drop constraint "projects_owner_email_fk"',
		);
		const dropColumnIndex = result.sql.indexOf('drop column "email"');
		expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
		expect(dropColumnIndex).toBeGreaterThan(dropConstraintIndex);
	});
});
