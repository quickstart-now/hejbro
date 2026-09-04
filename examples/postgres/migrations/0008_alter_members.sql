-- hejbro migration
-- hejbro: 0.1.1
-- ~ table app.members [index "members_email_lower_idx" added]
-- ~ table app.tasks [column "metadata" added, index "tasks_metadata_idx" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:9daab0d9595c0e4be815c3942a8a5548e610665af5b537f66df2d5decc0b1dda
-- snapshot: sha256:bd8cf44733d36714c684932d8a182fe79fc07b0795d4ce3b847fabad19655840

create index "members_email_lower_idx" on "app"."members" ((lower("members"."email")));

alter table "app"."tasks" add column "metadata" jsonb;

create index "tasks_metadata_idx" on "app"."tasks" using gin ("metadata" jsonb_path_ops);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at", "metadata" from "app"."tasks" where "app"."tasks"."status" <> 'done';
