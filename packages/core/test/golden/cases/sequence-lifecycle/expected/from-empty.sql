-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]

create schema "app";

create table "app"."posts" (
	"id" integer not null,
	"title" text,
	primary key ("id")
);