import type { HejbroInput } from "hejbro";
import {
	and,
	between,
	check,
	defineTrigger,
	defineView,
	desc,
	eq,
	exists,
	grant,
	gte,
	inArray,
	index,
	isNotNull,
	isNull,
	literal,
	ne,
	numeric,
	rls,
	roleName,
	schema,
	select,
	smallint,
	sql,
	table,
	text,
	timestamptz,
	uuid,
} from "hejbro";

/**
 * A generic team-workspace schema (O1) exercising every core DSL feature
 * once: CHECK constraints (typed and `sql`-templated), a partial ordered
 * index, a partial unique index, a self-referencing FK, RLS with two
 * roles, a before-trigger, a view, and schema-level grants. Six steps
 * (`step-1` … `step-6`) evolve it; this is step 3 — tightens
 * `projects.owner_id`'s referential actions and makes the due-date index's
 * nulls placement explicit.
 */
export const app = schema("app");

/** Two schema-level roles the RLS policies and grants below are scoped to — plain role names (D43), not tied to any provider preset. */
export const appReaderRole = roleName("app_reader");
export const appWriterRole = roleName("app_writer");

export const members = table(
	app,
	"members",
	{
		id: uuid().primaryKey().defaultRandom(),
		email: text().notNull().unique(),
		displayName: text().notNull(),
		role: text().notNull().default("member"),
	},
	(t) => ({
		checks: [
			check(
				"members_role_valid",
				inArray(t.role, ["owner", "admin", "member"]),
			),
		],
		rls: rls.enabled({
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			readAll: rls
				.policy("members_read_all")
				.for("select")
				.to(appReaderRole)
				.using(literal(true)),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("members_write_all")
				.for("all")
				.to(appWriterRole)
				.using(literal(true))
				.withCheck(literal(true)),
		}),
	}),
);

export const projects = table(
	app,
	"projects",
	{
		id: uuid().primaryKey().defaultRandom(),
		slug: text().notNull().unique(),
		name: text().notNull(),
		ownerId: uuid().notNull(),
		archivedAt: timestamptz(),
	},
	(t) => ({
		foreignKeys: [
			// Step 3: tightened from the default referential actions to an
			// explicit `on delete restrict on update cascade`.
			{
				columns: [t.ownerId],
				references: { table: members, columns: [members.id] },
				onDelete: "restrict",
				onUpdate: "cascade",
			},
		],
		checks: [
			check(
				"projects_slug_format",
				sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
			),
		],
		rls: rls.enabled({
			// Archived projects are hidden from readers — a real (not merely permissive) predicate.
			readAll: rls
				.policy("projects_read_all")
				.for("select")
				.to(appReaderRole)
				.using(isNull(t.archivedAt)),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("projects_write_all")
				.for("all")
				.to(appWriterRole)
				.using(literal(true))
				.withCheck(literal(true)),
		}),
	}),
);

export const tasks = table(
	app,
	"tasks",
	{
		id: uuid().primaryKey().defaultRandom(),
		projectId: uuid().notNull(),
		title: text().notNull(),
		status: text().notNull().default("todo"),
		priority: smallint().notNull().default(3),
		dueAt: timestamptz(),
		estimateHours: numeric(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.projectId],
				references: { table: projects, columns: [projects.id] },
				onDelete: "cascade",
			},
		],
		indexes: [
			// Step 3: nulls placement made explicit (`nulls last`) — steps 1/2
			// left it at Postgres's default for `desc`.
			index()
				.on(t.projectId, desc(t.dueAt, { nulls: "last" }))
				.where(ne(t.status, "done")),
			index().unique().on(t.projectId, t.title).where(ne(t.status, "done")),
		],
		checks: [
			check(
				"tasks_title_length",
				sql`char_length(${t.title}) between 1 and 200`,
			),
			check(
				"tasks_status_valid",
				inArray(t.status, ["todo", "in_progress", "done"]),
			),
			check("tasks_priority_range", between(t.priority, 1, 5)),
			check("tasks_estimate_hours_non_negative", gte(t.estimateHours, 0)),
		],
		rls: rls.enabled({
			// Tasks belonging to an archived project are hidden from readers — a real (not merely permissive) predicate, reached with exists() (D26).
			readAll: rls
				.policy("tasks_read_all")
				.for("select")
				.to(appReaderRole)
				.using(
					exists(
						select(projects).where(
							and(eq(projects.id, t.projectId), isNull(projects.archivedAt)),
						),
					),
				),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("tasks_write_all")
				.for("all")
				.to(appWriterRole)
				.using(literal(true))
				.withCheck(literal(true)),
		}),
	}),
);

export const comments = table(
	app,
	"comments",
	{
		id: uuid().primaryKey().defaultRandom(),
		taskId: uuid().notNull(),
		parentId: uuid(),
		body: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.taskId],
				references: { table: tasks, columns: [tasks.id] },
				onDelete: "cascade",
			},
			// Self-referencing FK (D52): `table` is omitted, derived from the
			// referenced column's own ref.
			{
				columns: [t.parentId],
				references: { columns: [t.id] },
				onDelete: "cascade",
			},
		],
		checks: [
			check("comments_body_not_blank", sql`length(btrim(${t.body})) > 0`),
		],
		rls: rls.enabled({
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			readAll: rls
				.policy("comments_read_all")
				.for("select")
				.to(appReaderRole)
				.using(literal(true)),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("comments_write_all")
				.for("all")
				.to(appWriterRole)
				.using(literal(true))
				.withCheck(literal(true)),
		}),
	}),
);

/**
 * Enforces reply nesting stays one level deep: a comment whose parent
 * already has a parent is rejected. Mirrors the single-depth reply rule
 * pinned by the golden case `comments-single-depth` (`ctx.rowOrNull` +
 * `ctx.if` + `ctx.raise`).
 */
export const commentsSingleDepth = defineTrigger(
	comments,
	{
		name: "comments_single_depth",
		timing: "before",
		events: ["insert", { update: ["parentId"] }],
		forEach: "row",
		functionName: "comments_enforce_single_depth",
	},
	(ctx, { new: row }) => {
		ctx.if(isNull(row.parentId), () => {
			ctx.return(row);
		});
		const parent = ctx.rowOrNull(
			select({ parentId: comments.parentId }, comments).where(
				eq(comments.id, row.parentId),
			),
			"parent",
		);
		ctx.if(isNotNull(parent.parentId), () => {
			ctx.raise(
				"the parent comment already has a parent — replies may only nest one level deep (parent_id=%)",
				row.parentId,
			);
		});
		ctx.return(row);
	},
);

/** Tasks not yet marked done — `securityInvoker: true` so it runs under the querying role's own RLS, not the view owner's. */
export const openTasks = defineView(
	app,
	"open_tasks",
	select(tasks).where(ne(tasks.status, "done")),
	{ securityInvoker: true },
);

export const appUsageGrant = grant(app).usage.to(appReaderRole, appWriterRole);
export const appReaderSelectGrant = grant(app)
	.tables("select")
	.to(appReaderRole);
export const appWriterAllGrant = grant(app)
	.tables("select", "insert", "update", "delete")
	.to(appWriterRole);
// one-shot grants only cover tables that exist when they run; default privileges cover the ones later migrations add — see #121
export const appReaderDefaultSelectGrant = grant(app)
	.defaultPrivileges.tables("select")
	.to(appReaderRole);
export const appWriterDefaultAllGrant = grant(app)
	.defaultPrivileges.tables("select", "insert", "update", "delete")
	.to(appWriterRole);

export const declarations: ReadonlyArray<HejbroInput> = [
	app,
	members,
	projects,
	tasks,
	comments,
	commentsSingleDepth,
	openTasks,
	appUsageGrant,
	appReaderSelectGrant,
	appWriterAllGrant,
	appReaderDefaultSelectGrant,
	appWriterDefaultAllGrant,
];
