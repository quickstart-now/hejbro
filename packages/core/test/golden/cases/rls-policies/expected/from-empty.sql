-- hejbro migration
-- + schema ddland [new]
-- + table ddland.comments [new]
-- + table ddland.posts [new]
-- + rls ddland.comments [new]
-- + rls ddland.posts [new]
-- + policy ddland.comments.comments_read_visible [new]
-- + policy ddland.posts.posts_read_published [new]

create schema "ddland";

create table "ddland"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"deleted_at" timestamp with time zone,
	primary key ("id")
);

create table "ddland"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	primary key ("id")
);

alter table "ddland"."comments" enable row level security;

alter table "ddland"."posts" enable row level security;

drop policy if exists "comments_read_visible" on "ddland"."comments";

create policy "comments_read_visible" on "ddland"."comments" for select to "anon" using (("ddland"."comments"."deleted_at" is null) and exists (select 1 from "ddland"."posts" where ("ddland"."posts"."id" = "ddland"."comments"."post_id") and ("ddland"."posts"."status" = 'published')));

drop policy if exists "posts_read_published" on "ddland"."posts";

create policy "posts_read_published" on "ddland"."posts" for select to "anon" using (("ddland"."posts"."status" = 'published') and ("ddland"."posts"."published_at" is not null));