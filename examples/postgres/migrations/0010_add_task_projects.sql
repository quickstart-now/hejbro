-- hejbro migration
-- hejbro: 0.2.0-pre.1
-- + view app.task_projects [new]
-- parent-snapshot: sha256:c794384bce2cba28686a600c9b07db61386a1062033c35c832ae2400e4bc6575
-- snapshot: sha256:88394459665c1e21d5551bddc822ca71145340537bc1140bf04a9fc61e1ddb48

create or replace view "app"."task_projects" with (security_invoker = true) as select "app"."tasks"."id" as "task_id", "app"."tasks"."title" as "task_title", "app"."projects"."id" as "project_id", "app"."projects"."name" as "project_name" from "app"."tasks" inner join "app"."projects" on "app"."tasks"."project_id" = "app"."projects"."id";

grant select on all tables in schema "app" to "app_auditor";

grant select on all tables in schema "app" to "app_reader";

grant select, insert, update, delete on all tables in schema "app" to "app_writer";
