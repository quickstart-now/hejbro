-- hejbro migration
-- hejbro: 0.1.1
-- ~ table app.members [index "members_email_lower_idx" added]
-- ~ table app.tasks [column "metadata" added, index "tasks_metadata_idx" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:5419679621a99bf56750b19a50b0d5f6d06be613df8474ae6d30eed64b3c2216
-- snapshot: sha256:3b7be8f9a007dff76bb426122a24038e9778cca71316caaf09fb26f7fde5c581

create index "members_email_lower_idx" on "app"."members" ((lower("app"."members"."email")));

alter table "app"."tasks" add column "metadata" jsonb;

create index "tasks_metadata_idx" on "app"."tasks" using gin ("metadata" jsonb_path_ops);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at", "metadata" from "app"."tasks" where "app"."tasks"."status" <> 'done';
