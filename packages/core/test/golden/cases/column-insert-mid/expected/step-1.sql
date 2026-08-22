-- hejbro migration
-- ~ table app.projects [column "description" added]
-- ~ function app.archive_project [body changed]
-- ~ view app.projects_v [view changed]

alter table "app"."projects" add column "description" text;

create or replace function "app"."archive_project"(project_id uuid)
returns setof "app"."projects"
language plpgsql
as $function$
begin
	return query update "app"."projects" set "archived_at" = now() where "app"."projects"."id" = project_id returning "id", "title", "archived_at", "description";
end;
$function$;

create or replace view "app"."projects_v" as select "id", "title", "archived_at", "description" from "app"."projects";