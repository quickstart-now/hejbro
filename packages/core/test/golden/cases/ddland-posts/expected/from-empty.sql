-- hejbro migration
-- + schema ddland [new]
-- + enum ddland.post_status [new]
-- + table ddland.comments [new]
-- + table ddland.posts [new]

create schema "ddland";

create type "ddland"."post_status" as enum ('draft', 'published');

create table "ddland"."comments" (
	"id" uuid not null default gen_random_uuid(),
	"post_id" uuid not null,
	"body" text not null,
	primary key ("id")
);

create table "ddland"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"published_at" timestamp with time zone,
	"status" "ddland"."post_status" not null,
	primary key ("id")
);

create index "posts_published_at_idx" on "ddland"."posts" ("published_at");