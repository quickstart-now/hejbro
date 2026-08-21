-- hejbro migration
-- ~ table app.projects [foreign key "projects_owner_id_fk" changed]
-- ~ table app.tasks [index "tasks_project_id_due_at_idx" changed]
-- parent-snapshot: sha256:c2a76122d3d80693d0e4c16e14c818254876e6e5e164a05e45c7e74ec2443853
-- snapshot: sha256:0b002a4faccc3981be027a69686468deb1bfba69e8162669a6ff55830cba9060

alter table "app"."projects" drop constraint "projects_owner_id_fk";

drop index "app"."tasks_project_id_due_at_idx";

create index "tasks_project_id_due_at_idx" on "app"."tasks" ("project_id", "due_at" desc nulls last) where "app"."tasks"."status" <> 'done';

alter table "app"."projects" add constraint "projects_owner_id_fk" foreign key ("owner_id") references "app"."members" ("id") on delete restrict on update cascade;
