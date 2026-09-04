-- hejbro migration
-- ~ table app.tasks [column "estimate_hours" added, check "tasks_estimate_hours_non_negative" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:231fbfcbae9fdecd9cf2857647e9a6cc9be6e985993fa401e27f10d798b9a016
-- snapshot: sha256:1ca3b46bfdb0b2dbedcd963d1acb80f883d5fa11bf26b797f2446047f06ba82d

alter table "app"."tasks" add column "estimate_hours" numeric;

alter table "app"."tasks" add constraint "tasks_estimate_hours_non_negative" check ("tasks"."estimate_hours" >= 0);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "due_at", "estimate_hours" from "app"."tasks" where "app"."tasks"."status" <> 'done';
