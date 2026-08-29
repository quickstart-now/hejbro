-- hejbro migration
-- + schema app [new]
-- + table app.audit_log [new]
-- + table app.posts [new]
-- + function app.audit_posts_changes [new]
-- + trigger app.posts.audit_posts [new]

create schema "app";

create table "app"."audit_log" (
	"id" uuid not null default gen_random_uuid(),
	"table_name" text not null,
	"changed_at" timestamp with time zone not null default now(),
	constraint "audit_log_pkey" primary key ("id")
);

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	constraint "posts_pkey" primary key ("id")
);

create or replace function "app"."audit_posts_changes"()
returns trigger
language plpgsql
as $function$
begin
	insert into "app"."audit_log" ("table_name") values ('posts');
	return new;
end;
$function$;

drop trigger if exists "audit_posts" on "app"."posts";

create trigger "audit_posts"
	after update on "app"."posts"
	for each row execute function "app"."audit_posts_changes"();