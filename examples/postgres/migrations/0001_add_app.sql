-- hejbro migration
-- + schema app [new]
-- + table app.comments [new]
-- + table app.members [new]
-- + table app.projects [new]
-- + table app.tasks [new]
-- + function app.comments_enforce_single_depth [new]
-- + trigger app.comments.comments_single_depth [new]
-- + rls app.comments [new]
-- + rls app.members [new]
-- + rls app.projects [new]
-- + rls app.tasks [new]
-- + policy app.comments.comments_read_all [new]
-- + policy app.comments.comments_write_all [new]
-- + policy app.members.members_read_all [new]
-- + policy app.members.members_write_all [new]
-- + policy app.projects.projects_read_all [new]
-- + policy app.projects.projects_write_all [new]
-- + policy app.tasks.tasks_read_all [new]
-- + policy app.tasks.tasks_write_all [new]
-- + view app.open_tasks [new]
-- + grant app.all-tables-privileges.app_reader [new]
-- + grant app.all-tables-privileges.app_writer [new]
-- + grant app.default-table-privileges.app_reader [new]
-- + grant app.default-table-privileges.app_writer [new]
-- + grant app.schema-usage.app_reader [new]
-- + grant app.schema-usage.app_writer [new]
-- parent-snapshot: sha256:d379e9576f63f1d63d29561b7366135984e883890a8efcb780b4e53648a77c7c
-- snapshot: sha256:75fa48f90e088c1712b4e8eecbadd1ef4a9b26ceb016fc6eaad4afbc81b54e7c

create schema "app";

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"task_id" uuid not null,
	"parent_id" uuid,
	"body" text not null,
	primary key ("id"),
	constraint "comments_body_not_blank" check (length(btrim("app"."comments"."body")) > 0)
);

create table "app"."members" (
	"id" uuid not null default gen_random_uuid(),
	"email" text not null unique,
	"display_name" text not null,
	"role" text not null default 'member',
	primary key ("id"),
	constraint "members_role_valid" check ("app"."members"."role" in ('owner', 'admin', 'member'))
);

create table "app"."projects" (
	"id" uuid not null default gen_random_uuid(),
	"slug" text not null unique,
	"name" text not null,
	"owner_id" uuid not null,
	"archived_at" timestamp with time zone,
	primary key ("id"),
	constraint "projects_slug_format" check ("app"."projects"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create table "app"."tasks" (
	"id" uuid not null default gen_random_uuid(),
	"project_id" uuid not null,
	"title" text not null,
	"status" text not null default 'todo',
	"priority" smallint not null default 3,
	"due_at" timestamp with time zone,
	primary key ("id"),
	constraint "tasks_title_length" check (char_length("app"."tasks"."title") between 1 and 200),
	constraint "tasks_status_valid" check ("app"."tasks"."status" in ('todo', 'in_progress', 'done')),
	constraint "tasks_priority_range" check ("app"."tasks"."priority" between 1 and 5)
);

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc) where "app"."tasks"."status" <> 'done';

create unique index "tasks_project_id_title_idx" on "app"."tasks" ("project_id", "title") where "app"."tasks"."status" <> 'done';

create or replace function "app"."comments_enforce_single_depth"()
returns trigger
language plpgsql
as $function$
declare
	parent_parent_id uuid;
begin
	if new.parent_id is null then
		return new;
	end if;
	select "app"."comments"."parent_id" as "parent_id" into parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id;
	if parent_parent_id is not null then
		raise exception 'the parent comment already has a parent — replies may only nest one level deep (parent_id=%)', new.parent_id;
	end if;
	return new;
end;
$function$;

drop trigger if exists "comments_single_depth" on "app"."comments";

create trigger "comments_single_depth"
	before insert or update of "parent_id" on "app"."comments"
	for each row execute function "app"."comments_enforce_single_depth"();

alter table "app"."comments" enable row level security;

alter table "app"."members" enable row level security;

alter table "app"."projects" enable row level security;

alter table "app"."tasks" enable row level security;

drop policy if exists "comments_read_all" on "app"."comments";

create policy "comments_read_all" on "app"."comments" for select to "app_reader" using ("app"."comments"."id" is not null);

drop policy if exists "comments_write_all" on "app"."comments";

create policy "comments_write_all" on "app"."comments" for all to "app_writer" using ("app"."comments"."id" is not null) with check ("app"."comments"."id" is not null);

drop policy if exists "members_read_all" on "app"."members";

create policy "members_read_all" on "app"."members" for select to "app_reader" using ("app"."members"."id" is not null);

drop policy if exists "members_write_all" on "app"."members";

create policy "members_write_all" on "app"."members" for all to "app_writer" using ("app"."members"."id" is not null) with check ("app"."members"."id" is not null);

drop policy if exists "projects_read_all" on "app"."projects";

create policy "projects_read_all" on "app"."projects" for select to "app_reader" using ("app"."projects"."archived_at" is null);

drop policy if exists "projects_write_all" on "app"."projects";

create policy "projects_write_all" on "app"."projects" for all to "app_writer" using ("app"."projects"."id" is not null) with check ("app"."projects"."id" is not null);

drop policy if exists "tasks_read_all" on "app"."tasks";

create policy "tasks_read_all" on "app"."tasks" for select to "app_reader" using (exists (select 1 from "app"."projects" where ("app"."projects"."id" = "app"."tasks"."project_id") and ("app"."projects"."archived_at" is null)));

drop policy if exists "tasks_write_all" on "app"."tasks";

create policy "tasks_write_all" on "app"."tasks" for all to "app_writer" using ("app"."tasks"."id" is not null) with check ("app"."tasks"."id" is not null);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at" from "app"."tasks" where "app"."tasks"."status" <> 'done';

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

alter default privileges in schema "app" grant select on tables to "app_reader";

alter default privileges in schema "app" grant select, insert, update, delete on tables to "app_writer";

grant usage on schema "app" to "app_reader";

grant usage on schema "app" to "app_writer";

alter table "app"."comments" add constraint "comments_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;

alter table "app"."comments" add constraint "comments_parent_id_fk" foreign key ("parent_id") references "app"."comments" ("id") on delete cascade;

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id");

alter table "app"."tasks" add constraint "tasks_project_id_fk" foreign key ("project_id") references "app"."projects" ("id") on delete cascade;
