-- hejbro migration
-- + schema ddland [new]
-- + table ddland.comments [new]
-- + table ddland.post_translations [new]
-- + table ddland.posts [new]
-- + rls ddland.comments [new]
-- + rls ddland.post_translations [new]
-- + rls ddland.posts [new]
-- + policy ddland.comments.comments_read_visible [new]
-- + policy ddland.post_translations.post_translations_read_published [new]
-- + policy ddland.posts.posts_insert_draft_only [new]
-- + policy ddland.posts.posts_read_published [new]
-- + grant ddland.allTablesPrivileges.anon [new]
-- + grant ddland.allTablesPrivileges.service_role [new]
-- + grant ddland.defaultTablePrivileges.anon [new]
-- + grant ddland.defaultTablePrivileges.service_role [new]
-- + grant ddland.schemaUsage.anon [new]
-- + grant ddland.schemaUsage.service_role [new]

create schema "ddland";

create table "ddland"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"deleted_at" timestamp with time zone,
	primary key ("id")
);

create table "ddland"."post_translations" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"locale" text not null,
	primary key ("id")
);

create table "ddland"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	primary key ("id")
);

alter table "ddland"."comments" enable row level security;

alter table "ddland"."post_translations" enable row level security;

alter table "ddland"."posts" enable row level security;

drop policy if exists "comments_read_visible" on "ddland"."comments";

create policy "comments_read_visible" on "ddland"."comments" for select to "anon" using (("ddland"."comments"."deleted_at" is null) and exists (select 1 from "ddland"."posts" where ("ddland"."posts"."id" = "ddland"."comments"."post_id") and ("ddland"."posts"."status" = 'published') and ("ddland"."posts"."published_at" <= now())));

drop policy if exists "post_translations_read_published" on "ddland"."post_translations";

create policy "post_translations_read_published" on "ddland"."post_translations" for select to "anon" using (exists (select 1 from "ddland"."posts" where ("ddland"."posts"."id" = "ddland"."post_translations"."post_id") and ("ddland"."posts"."status" = 'published') and ("ddland"."posts"."published_at" <= now())));

drop policy if exists "posts_insert_draft_only" on "ddland"."posts";

create policy "posts_insert_draft_only" on "ddland"."posts" for insert to "authenticated" with check ("ddland"."posts"."status" = 'draft');

drop policy if exists "posts_read_published" on "ddland"."posts";

create policy "posts_read_published" on "ddland"."posts" for select to "anon" using (("ddland"."posts"."status" = 'published') and ("ddland"."posts"."published_at" <= now()));

grant select on all tables in schema "ddland" to "anon";

grant select, insert, update, delete on all tables in schema "ddland" to "service_role";

alter default privileges in schema "ddland" grant select on tables to "anon";

alter default privileges in schema "ddland" grant select, insert, update, delete on tables to "service_role";

grant usage on schema "ddland" to "anon";

grant usage on schema "ddland" to "service_role";