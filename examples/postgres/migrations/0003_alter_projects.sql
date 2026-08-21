-- hejbro migration
-- ~ table app.projects [foreign key "projects_owner_id_fk" changed]
-- ~ table app.tasks [index "tasks_project_id_due_at_idx" changed]
-- parent-snapshot: sha256:448c21250aa2d93686ba411da7d55b410c25726a86aacda75db91d46cf2b0e73
-- snapshot: sha256:59c02a549c4f847611c7b55ac050ece4b5df0a4d9936b7710e3c1705a8896e9b

alter table "app"."projects" drop constraint "projects_owner_id_fk";

drop index "app"."tasks_project_id_due_at_idx";

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc nulls last) where "app"."tasks"."status" <> 'done';

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id") on delete restrict on update cascade;
