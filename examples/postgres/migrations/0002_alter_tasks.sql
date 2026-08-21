-- hejbro migration
-- ~ table app.tasks [column "estimate_hours" added, check "tasks_estimate_hours_non_negative" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:75fa48f90e088c1712b4e8eecbadd1ef4a9b26ceb016fc6eaad4afbc81b54e7c
-- snapshot: sha256:db90ef60a80684bb367eb7bfd550d3d8844a74e692f1e1d0326bff81041c5bba

alter table "app"."tasks" add column "estimate_hours" numeric;

alter table "app"."tasks" add constraint "tasks_estimate_hours_non_negative" check ("app"."tasks"."estimate_hours" >= 0);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';
