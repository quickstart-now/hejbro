-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]
-- + view app.published_posts [new]

create schema "app";

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	constraint "posts_pkey" primary key ("id")
);

create or replace view "app"."published_posts" as select "id", "status", "published_at" from "app"."posts" where "app"."posts"."published_at" is not null;