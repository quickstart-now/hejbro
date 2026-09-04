-- hejbro migration
-- hejbro: 0.1.1
-- ~ table app.members [index "members_email_lower_idx" added]
-- ~ table app.tasks [column "metadata" added, index "tasks_metadata_idx" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:22797d90405a12af7a8436bd80cc6ce64e3e6fe15389d6a32e2645ba085f59c4
-- snapshot: sha256:a61d294e61b274fbd7d0856e7e1581625b501e12fa39bbdb2fe420bcad83391b

create index "members_email_lower_idx" on "app"."members" ((lower("members"."email")));

alter table "app"."tasks" add column "metadata" jsonb;

create index "tasks_metadata_idx" on "app"."tasks" using gin ("metadata" jsonb_path_ops);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at", "metadata" from "app"."tasks" where "app"."tasks"."status" <> 'done';
