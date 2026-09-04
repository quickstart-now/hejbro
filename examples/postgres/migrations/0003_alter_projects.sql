-- hejbro migration
-- ~ table app.projects [foreign key "projects_owner_id_fk" changed]
-- ~ table app.tasks [index "tasks_project_id_due_at_idx" changed]
-- parent-snapshot: sha256:7eb308f4001b91e0667730841b5fe27092aed25e6b6a0bdf82c51fc50acbb6da
-- snapshot: sha256:d81673f3b0abb5dd3faa513657217dbab7176d99186cdd9702a578d4e0151176

alter table "app"."projects" drop constraint "projects_owner_id_fk";

drop index "app"."tasks_project_id_due_at_idx";

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc nulls last) where "tasks"."status" <> 'done';

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id") on delete restrict on update cascade;
