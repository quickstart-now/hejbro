-- hejbro migration
-- ~ table app.projects [foreign key "projects_owner_id_fk" changed]
-- ~ table app.tasks [index "tasks_project_id_due_at_idx" changed]
-- parent-snapshot: sha256:a0e766ec782e692c892399186be29bbcc979f3604239f8c3da6188be3ee9a3d1
-- snapshot: sha256:735a1314ca4ba129465b24a6c1ef38942deb93a6c409f01215e97d1bf25c542e

alter table "app"."projects" drop constraint "projects_owner_id_fk";

drop index "app"."tasks_project_id_due_at_idx";

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc nulls last) where "app"."tasks"."status" <> 'done';

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id") on delete restrict on update cascade;
