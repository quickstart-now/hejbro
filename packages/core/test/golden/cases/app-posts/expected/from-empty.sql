-- hejbro migration
-- + schema app [new]
-- + enum app.post_status [new]
-- + table app.comments [new]
-- + table app.posts [new]

create schema "app";

create type "app"."post_status" as enum ('draft', 'published');

create table "app"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"body" text not null,
	constraint "comments_pkey" primary key ("id")
);

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"published_at" timestamp with time zone,
	"status" "app"."post_status" not null,
	constraint "posts_pkey" primary key ("id")
);

create index "posts_published_at_idx" on "app"."posts" ("published_at");