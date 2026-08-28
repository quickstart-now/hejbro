-- hejbro migration
-- + schema app [new]
-- + table app.widgets [new]

create schema "app";

create table "app"."widgets" (
	"price" numeric,
	"qty" integer,
	"total" numeric generated always as (price * qty) stored
);