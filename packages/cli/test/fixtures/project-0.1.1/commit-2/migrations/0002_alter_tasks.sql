-- hejbro migration
-- ~ table app.tasks [column "estimate_hours" added, check "tasks_estimate_hours_non_negative" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:549b6a31d81e336bf45ef9f77b8b8aefe2a7c4dbaa0d0d9da0f1a3f6a593c83c
-- snapshot: sha256:37c1dd64b27834268ab1aa4d1fbd07544bd9acfcf9a0cd6bc84df197f8076be0

alter table "app"."tasks" add column "estimate_hours" numeric;

alter table "app"."tasks" add constraint "tasks_estimate_hours_non_negative" check ("app"."tasks"."estimate_hours" >= 0);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';
