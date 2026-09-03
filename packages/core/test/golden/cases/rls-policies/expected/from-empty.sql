-- hejbro migration
-- + schema app [new]
-- + table app.comments [new]
-- + table app.posts [new]
-- + rls app.comments [new]
-- + rls app.posts [new]
-- + policy app.comments.comments_read_visible [new]
-- + policy app.posts.posts_read_published [new]

create schema "app";

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"deleted_at" timestamp with time zone,
	constraint "comments_pkey" primary key ("id")
);

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	constraint "posts_pkey" primary key ("id")
);

alter table "app"."comments" enable row level security;

alter table "app"."posts" enable row level security;

drop policy if exists "comments_read_visible" on "app"."comments";

create policy "comments_read_visible" on "app"."comments" for select to "anon" using (("comments"."deleted_at" is null) and exists (select 1 from "app"."posts" where ("posts"."id" = "comments"."post_id") and ("posts"."status" = 'published')));

drop policy if exists "posts_read_published" on "app"."posts";

create policy "posts_read_published" on "app"."posts" for select to "anon" using (("posts"."status" = 'published') and ("posts"."published_at" is not null));