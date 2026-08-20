-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]

create schema "app";

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"slug" text not null,
	"status" text not null,
	"created_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	primary key ("id")
);

create index "posts_recent_idx" on "app"."posts" ("created_at", "published_at" desc nulls first);

create unique index "posts_slug_published_uidx" on "app"."posts" ("slug") where "app"."posts"."published_at" is not null;

create index "posts_status_idx" on "app"."posts" ("status");