-- hejbro migration
-- + schema app [new]
-- + table app.projects [new]
-- + function app.archive_project [new]
-- + view app.projects_v [new]

create schema "app";

create table "app"."projects" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	"archived_at" timestamp with time zone,
	constraint "projects_pkey" primary key ("id")
);

create or replace function "app"."archive_project"(project_id uuid)
returns setof "app"."projects"
language plpgsql
as $function$
begin
	return query update "app"."projects" set "archived_at" = now() where "app"."projects"."id" = project_id returning "id", "title", "archived_at";
end;
$function$;

create or replace view "app"."projects_v" as select "id", "title", "archived_at" from "app"."projects";