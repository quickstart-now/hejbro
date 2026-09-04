-- hejbro migration
-- ~ table app.projects [foreign key "projects_owner_id_fk" changed]
-- ~ table app.tasks [index "tasks_project_id_due_at_idx" changed]
-- parent-snapshot: sha256:1ca3b46bfdb0b2dbedcd963d1acb80f883d5fa11bf26b797f2446047f06ba82d
-- snapshot: sha256:57556d146f3ae1eb982778e223ed2c48d862a63672cc00db665cd6b57d859a05

alter table "app"."projects" drop constraint "projects_owner_id_fk";

drop index "app"."tasks_project_id_due_at_idx";

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc nulls last) where "tasks"."status" <> 'done';

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id") on delete restrict on update cascade;
