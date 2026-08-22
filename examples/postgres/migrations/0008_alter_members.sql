-- hejbro migration
-- hejbro: 0.1.1
-- ~ table app.members [index "members_email_lower_idx" added]
-- ~ table app.tasks [column "metadata" added, index "tasks_metadata_idx" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:2009e0c2a17e1aed6ab619cf3d69943dc636beafffd9fb29fefb416f363188bd
-- snapshot: sha256:d03ce75beee84229bc34e6dcd7c07b6a6acf4735249289cef72026d11643e58d

create index "members_email_lower_idx" on "app"."members" (lower("app"."members"."email"));

alter table "app"."tasks" add column "metadata" jsonb;

create index "tasks_metadata_idx" on "app"."tasks" using gin ("metadata" jsonb_path_ops);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at", "metadata" from "app"."tasks" where "app"."tasks"."status" <> 'done';
