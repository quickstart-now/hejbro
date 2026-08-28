-- hejbro migration
-- + table app.task_schedules [new]
-- ~ table app.tasks [column "closed_at" added, column "due_at" dropped, index "tasks_project_id_due_at_idx" dropped]
-- + rls app.task_schedules [new]
-- + policy app.task_schedules.task_schedules_read_all [new]
-- + policy app.task_schedules.task_schedules_write_all [new]
-- ~ view app.open_tasks [view columns changed; recreating]
-- parent-snapshot: sha256:735a1314ca4ba129465b24a6c1ef38942deb93a6c409f01215e97d1bf25c542e
-- snapshot: sha256:cb5a16fd5538b0f682f7e3ef60b9715085521c8f24d016fea110dc6e4a88f4d6

drop view if exists "app"."open_tasks";

create table "app"."task_schedules" (
	"task_id" uuid not null,
	"due_at" timestamp with time zone,
	"reminder_at" timestamp with time zone,
	constraint "task_schedules_pkey" primary key ("task_id"),
	constraint "task_schedules_reminder_before_due" check ("app"."task_schedules"."reminder_at" < "app"."task_schedules"."due_at")
);

create index "task_schedules_due_at_idx" on "app"."task_schedules" ("due_at" desc);

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";

drop index "app"."tasks_project_id_due_at_idx";

alter table "app"."tasks" drop column "due_at";

alter table "app"."tasks" add column "closed_at" timestamp with time zone;

alter table "app"."task_schedules" enable row level security;

drop policy if exists "task_schedules_read_all" on "app"."task_schedules";

create policy "task_schedules_read_all" on "app"."task_schedules" for select to "app_reader" using (true);

drop policy if exists "task_schedules_write_all" on "app"."task_schedules";

create policy "task_schedules_write_all" on "app"."task_schedules" for all to "app_writer" using (true) with check (true);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at" from "app"."tasks" where "app"."tasks"."status" <> 'done';

alter table "app"."task_schedules" add constraint "task_schedules_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
