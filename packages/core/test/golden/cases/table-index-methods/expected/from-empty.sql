-- hejbro migration
-- + schema app [new]
-- + table app.docs [new]
-- + table app.users [new]

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

create table "app"."users" (
	"id" uuid not null default gen_random_uuid(),
	"email" text,
	"deleted_at" timestamp with time zone,
	constraint "users_pkey" primary key ("id")
);

create index "users_email_lower_idx" on "app"."users" ((lower("users"."email")));

create unique index "users_email_lower_uidx" on "app"."users" ((lower("users"."email"))) where "users"."deleted_at" is null;