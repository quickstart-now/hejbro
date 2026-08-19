-- hejbro migration
-- + schema ddland [new]
-- + table ddland.posts [new]
-- + view ddland.published_posts [new]

create schema "ddland";

create table "ddland"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"status" text not null,
	"published_at" timestamp with time zone,
	primary key ("id")
);

create or replace view "ddland"."published_posts" as select "id", "status", "published_at" from "ddland"."posts" where "ddland"."posts"."published_at" is not null;