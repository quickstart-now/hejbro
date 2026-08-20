-- hejbro migration
-- + table app.task_schedules [new]
-- ~ table app.tasks [column "due_at" dropped, index "tasks_project_id_due_at_idx" dropped]
-- + rls app.task_schedules [new]
-- + policy app.task_schedules.task_schedules_read_all [new]
-- + policy app.task_schedules.task_schedules_write_all [new]
-- ~ view app.open_tasks [view columns changed; recreating]
-- parent-snapshot: sha256:f2d8f020ded21720b779851eb0281ac4dff662fa1c9397f6bed646722bacb4b3
-- snapshot: sha256:b8ea4644e15f3ce1315ddba5eb261613372ffdce0d92b39db8ff8be282a7f0be

create table "app"."task_schedules" (
	"task_id" uuid not null,
	"due_at" timestamp with time zone,
	"reminder_at" timestamp with time zone,
	primary key ("task_id"),
	constraint "task_schedules_reminder_before_due" check ("app"."task_schedules"."reminder_at" < "app"."task_schedules"."due_at")
);

create index "task_schedules_due_at_idx" on "app"."task_schedules" ("due_at" desc);

drop index "app"."tasks_project_id_due_at_idx";

alter table "app"."tasks" drop column "due_at";

alter table "app"."task_schedules" enable row level security;

drop policy if exists "task_schedules_read_all" on "app"."task_schedules";

create policy "task_schedules_read_all" on "app"."task_schedules" for select to "app_reader" using ("app"."task_schedules"."task_id" is not null);

drop policy if exists "task_schedules_write_all" on "app"."task_schedules";

create policy "task_schedules_write_all" on "app"."task_schedules" for all to "app_writer" using ("app"."task_schedules"."task_id" is not null) with check ("app"."task_schedules"."task_id" is not null);

drop view if exists "app"."open_tasks";

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';

alter table "app"."task_schedules" add constraint "task_schedules_task_id_fk" foreign key ("task_id") references "app"."tasks" ("id") on delete cascade;
