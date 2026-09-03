-- hejbro migration
-- ~ table app.tasks [column "estimate_hours" added, check "tasks_estimate_hours_non_negative" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:37980def9e1707c18aef17ce0cf53588f4f32e702900f3ad30c3a7dc0e2db9c5
-- snapshot: sha256:7eb308f4001b91e0667730841b5fe27092aed25e6b6a0bdf82c51fc50acbb6da

alter table "app"."tasks" add column "estimate_hours" numeric;

alter table "app"."tasks" add constraint "tasks_estimate_hours_non_negative" check ("app"."tasks"."estimate_hours" >= 0);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';
