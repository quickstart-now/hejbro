-- hejbro migration
-- hejbro: 0.1.1
-- ~ table app.members [index "members_email_lower_idx" added]
-- ~ table app.tasks [column "metadata" added, index "tasks_metadata_idx" added]
-- ~ view app.open_tasks [view changed]
-- parent-snapshot: sha256:b297df52a651aa02e2ada09a35f652651af5be5261e17851056c5e901ffccde6
-- snapshot: sha256:aafa748bf3cd54fe41fbc536214488f1b7203f5cf97fde15335440288209dbfe

create index "members_email_lower_idx" on "app"."members" ((lower("app"."members"."email")));

alter table "app"."tasks" add column "metadata" jsonb;

create index "tasks_metadata_idx" on "app"."tasks" using gin ("metadata" jsonb_path_ops);

create or replace view "app"."open_tasks" with (security_invoker = true) as select "id", "project_id", "title", "status", "priority", "estimate_hours", "closed_at", "metadata" from "app"."tasks" where "app"."tasks"."status" <> 'done';
