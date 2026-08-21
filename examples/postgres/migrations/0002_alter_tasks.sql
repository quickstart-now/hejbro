-- hejbro migration
-- ~ table app.tasks [column "estimate_hours" added, check "tasks_estimate_hours_non_negative" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:8ae8aa374f2640edb767d9df71b35784a9af88f355f818bfb1d5f4af02fb0cfb
-- snapshot: sha256:6e300666a69b452bc5250f1672b1d11626e1aa13687ec52e6a20229bd7eaf200

alter table "app"."tasks" add column "estimate_hours" numeric;

alter table "app"."tasks" add constraint "tasks_estimate_hours_non_negative" check ("app"."tasks"."estimate_hours" >= 0);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';
