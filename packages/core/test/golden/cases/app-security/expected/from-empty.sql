-- hejbro migration
-- + schema app [new]
-- + table app.comments [new]
-- + table app.post_translations [new]
-- + table app.posts [new]
-- + rls app.comments [new]
-- + rls app.post_translations [new]
-- + rls app.posts [new]
-- + policy app.comments.comments_read_visible [new]
-- + policy app.post_translations.post_translations_read_published [new]
-- + policy app.posts.posts_insert_draft_only [new]
-- + policy app.posts.posts_read_published [new]
-- + grant app.all-tables-privileges.anon [new]
-- + grant app.all-tables-privileges.service_role [new]
-- + grant app.default-table-privileges.anon [new]
-- + grant app.default-table-privileges.service_role [new]
-- + grant app.schema-usage.anon [new]
-- + grant app.schema-usage.service_role [new]

create schema "app";

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"deleted_at" timestamp with time zone,
	primary key ("id")
);

create table "app"."post_translations" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"locale" text not null,
	primary key ("id")
);

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	primary key ("id")
);

alter table "app"."comments" enable row level security;

alter table "app"."post_translations" enable row level security;

alter table "app"."posts" enable row level security;

drop policy if exists "comments_read_visible" on "app"."comments";

create policy "comments_read_visible" on "app"."comments" for select to "anon" using (("app"."comments"."deleted_at" is null) and exists (select 1 from "app"."posts" where ("app"."posts"."id" = "app"."comments"."post_id") and ("app"."posts"."status" = 'published') and ("app"."posts"."published_at" <= now())));

drop policy if exists "post_translations_read_published" on "app"."post_translations";

create policy "post_translations_read_published" on "app"."post_translations" for select to "anon" using (exists (select 1 from "app"."posts" where ("app"."posts"."id" = "app"."post_translations"."post_id") and ("app"."posts"."status" = 'published') and ("app"."posts"."published_at" <= now())));

drop policy if exists "posts_insert_draft_only" on "app"."posts";

create policy "posts_insert_draft_only" on "app"."posts" for insert to "authenticated" with check ("app"."posts"."status" = 'draft');

drop policy if exists "posts_read_published" on "app"."posts";

create policy "posts_read_published" on "app"."posts" for select to "anon" using (("app"."posts"."status" = 'published') and ("app"."posts"."published_at" <= now()));

grant select on all tables in schema "app" to "anon";

grant select, insert, update, delete on all tables in schema "app" to "service_role";

alter default privileges in schema "app" grant select on tables to "anon";

alter default privileges in schema "app" grant select, insert, update, delete on tables to "service_role";

grant usage on schema "app" to "anon";

grant usage on schema "app" to "service_role";