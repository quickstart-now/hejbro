-- hejbro migration
-- + schema app [new]
-- + table app.docs [new]

create schema "app";

create table "app"."docs" (
	"id" uuid not null default gen_random_uuid(),
	"data" jsonb,
	"created_at" timestamp with time zone,
	"owner_id" uuid,
	"body" text,
	constraint "docs_pkey" primary key ("id")
);

create index "docs_data_idx" on "app"."docs" using gin ("data" jsonb_path_ops);

create index "docs_created_at_idx" on "app"."docs" using brin ("created_at");

create index "docs_owner_id_idx" on "app"."docs" using hash ("owner_id");

create index "docs_body_trgm_idx" on "app"."docs" using gin ("body" gin_trgm_ops);