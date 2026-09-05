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
	insert,
	isNotNull,
	isNull,
	jsonb,
	literal,
	lt,
	ne,
	numeric,
	op,
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
 * roles, a before-trigger, a view, and schema-level grants. Nine steps
 * (`step-1` … `step-9`) evolve it; step 7 added `task_labels` (see the
 * #121 grant-sync note below, unchanged since); step 8 added non-B-tree
 * index access, an operator class, and an expression index (R11): a GIN
 * `jsonb_path_ops` index on `tasks.metadata` (new nullable `jsonb` column,
 * a plain `alter table ... add column`, no default) and a named expression
 * index `lower(email)` on the existing `members.email` column. Built-in
 * access methods and opclasses only (no `pg_trgm`/`pgvector`), so
 * `postgres:17-alpine` round-trips without installing an extension.
 * Postgres's own `grant ... on all tables in schema ...` only ever covers
 * the tables that existed *when it ran*, so without #121's fix
 * `app_auditor` would end up silently unable to select from `task_labels`
 * — a defect a golden test can't see (it never runs real SQL) but the
 * local round-trip does: a chain database (this committed migration
 * applied after the earlier ones) vs. a fresh database (one migration
 * from empty straight to this state) disagree on exactly
 * `task_labels`'s grants before the fix, and agree after it (D48/D49).
 * This is step 9 — #426's `ctx.execute(...)`: `auditTaskStatusChange`
 * executes an insert for its side effect (recording the status
 * transition) instead of losing it, the first body in the repository to
 * do so, and the real-Postgres counterpart to the golden case
 * `audit-posts` (`packages/core/test/golden/cases/audit-posts`).
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
		// Step 8: named expression index on the existing `email` column — no
		// new column needed, this table already carries a case-sensitive
		// unique constraint on it (R11).
		indexes: [index("members_email_lower_idx").on(sql`lower(${t.email})`)],
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
		ownerId: uuid()
			.notNull()
			.references(() => members.id, {
				onDelete: "restrict",
				onUpdate: "cascade",
			}),
		archivedAt: timestamptz(),
	},
	(t) => ({
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
		projectId: uuid()
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text().notNull(),
		status: text().notNull().default("todo"),
		priority: smallint().notNull().default(3),
		estimateHours: numeric(),
		// unrelated to due_at's move — added in the same step so the chain exercises the --confirm-drop path (D32 rule A needs a same-table drop + add pair).
		closedAt: timestamptz(),
		// Step 8: nullable, no default — a plain `alter table ... add column`
		// (R11); carries the GIN `jsonb_path_ops` index below.
		metadata: jsonb(),
	},
	(t) => ({
		// Step 4: the partial index over `due_at` is dropped along with the
		// column itself — `task_schedules` below gets its own ordered index.
		indexes: [
			index().unique().on(t.projectId, t.title).where(ne(t.status, "done")),
			// Step 8: GIN + jsonb_path_ops for `@>` containment queries on `metadata` (R11).
			index().using("gin").on(op(t.metadata, "jsonb_path_ops")),
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

/** One-to-one with `tasks`: the FK column doubles as the primary key — carries the scheduling fields `due_at` used to hold directly on `tasks`. */
export const taskSchedules = table(
	app,
	"task_schedules",
	{
		taskId: uuid()
			.primaryKey()
			.references(() => tasks.id, { onDelete: "cascade" }),
		dueAt: timestamptz(),
		reminderAt: timestamptz(),
	},
	(t) => ({
		indexes: [index().on(desc(t.dueAt))],
		checks: [
			check("task_schedules_reminder_before_due", lt(t.reminderAt, t.dueAt)),
		],
		rls: rls.enabled({
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			readAll: rls
				.policy("task_schedules_read_all")
				.for("select")
				.to(appReaderRole)
				.using(literal(true)),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("task_schedules_write_all")
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
		taskId: uuid()
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		parentId: uuid(),
		body: text().notNull(),
	},
	(t) => ({
		foreignKeys: [
			// Self-referencing FK (D52): `table` is omitted, derived from the
			// referenced column's own ref. Self-referencing foreign keys stay
			// on the `extras` path (add-references-actions, #514) — the
			// column-level `.references()` sugar above handles every
			// non-self, single-column edge in this table instead.
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
 * `taskId` was a single-column primary key in step 5, also doubling as
 * the FK to `tasks`; here `tagLabel` joins it, making the primary key
 * composite `(taskId, tagLabel)` — each task can only have each tag
 * once. A constraint's column list can't be ALTERed in place on a real
 * Postgres, only replaced (#24), so this step's migration is an
 * explicit `drop constraint` + `add constraint ... primary key
 * (task_id, tag_label)` against the table step 5 already created —
 * this round-trip is what proves both statements are real, accepted
 * Postgres SQL, not just correctly-generated text (the golden case
 * `table-constraints` already covers the same shape as a text
 * comparison, D48/D49's job is the executed counterpart).
 */
export const taskTags = table(app, "task_tags", {
	taskId: uuid()
		.primaryKey()
		.references(() => tasks.id, { onDelete: "cascade" }),
	tagLabel: text().notNull().primaryKey(),
});

/**
 * New in step 7 — its only reason to exist is a table added *after*
 * `appAuditorSelectGrant`'s schema-wide grant already stood (#121, see
 * this file's own top doc comment). No RLS/checks/indexes beyond what
 * keeps it a real table: the defect class this step defends is a
 * chain-vs-fresh grant mismatch, not another DSL feature.
 */
export const taskLabels = table(
	app,
	"task_labels",
	{
		id: uuid().primaryKey().defaultRandom(),
		taskId: uuid()
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		label: text().notNull(),
	},
	() => ({
		rls: rls.enabled({
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			readAll: rls
				.policy("task_labels_read_all")
				.for("select")
				.to(appReaderRole)
				.using(literal(true)),
			// permissive by design — this example shows the reader/writer role split, not row filtering.
			writeAll: rls
				.policy("task_labels_write_all")
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

/**
 * Step 10 (#742): a projection drawn from two joined tables whose column
 * names overlap (`id` on both) -- every projected column renders qualified
 * by its own table, or Postgres refuses the view body with `42702`
 * (the shape the harden-query-conformance constructor review found).
 */
export const taskProjects = defineView(
	app,
	"task_projects",
	select(
		{
			taskId: tasks.id,
			taskTitle: tasks.title,
			projectId: projects.id,
			projectName: projects.name,
		},
		tasks,
	).innerJoin(projects, eq(tasks.projectId, projects.id)),
	{ securityInvoker: true },
);

/** Step 9 (#426): one row per `tasks.status` transition, written by `auditTaskStatusChange`'s executed insert. */
export const taskStatusAudit = table(app, "task_status_audit", {
	id: uuid().primaryKey().defaultRandom(),
	taskId: uuid().notNull(),
	oldStatus: text().notNull(),
	newStatus: text().notNull(),
	changedAt: timestamptz().notNull().defaultNow(),
});

/**
 * Step 9 (#426): records every `tasks.status` change instead of losing
 * it — the pre-#426 body had no way to both build this insert and return
 * the trigger row, since a builder made and not returned was simply
 * dropped, silently. `ctx.execute(...)` runs it for its side effect, then
 * the trigger row is returned as before.
 */
export const auditTaskStatusChange = defineTrigger(
	tasks,
	{
		name: "audit_task_status_change",
		timing: "after",
		events: [{ update: ["status"] }],
		forEach: "row",
		functionName: "audit_task_status_change",
	},
	(ctx, { new: row, old }) => {
		ctx.execute(
			insert(taskStatusAudit).values({
				taskId: row.id,
				oldStatus: old.status,
				newStatus: row.status,
			}),
		);
		ctx.return(row);
	},
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
// #121: standing from step 1, like the reader/writer grants above — but
// deliberately given *no* matching defaultPrivileges counterpart, so
// `task_labels` (new this step) being this role's first table added
// *after* the grant already existed proves whether hejbro keeps a
// one-shot schema-wide grant in step with new tables. See this file's
// own top doc comment for the payoff.
export const appAuditorRole = roleName("app_auditor");
export const appAuditorSelectGrant = grant(app)
	.tables("select")
	.to(appAuditorRole);

export const declarations: ReadonlyArray<HejbroInput> = [
	app,
	members,
	projects,
	tasks,
	taskSchedules,
	taskTags,
	taskLabels,
	comments,
	commentsSingleDepth,
	openTasks,
	taskProjects,
	taskStatusAudit,
	auditTaskStatusChange,
	appUsageGrant,
	appReaderSelectGrant,
	appWriterAllGrant,
	appReaderDefaultSelectGrant,
	appWriterDefaultAllGrant,
	appAuditorSelectGrant,
];
