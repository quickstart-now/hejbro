-- hejbro migration
-- + schema app [new]
-- + table app.drafts [new]
-- + table app.profiles [new]
-- + table app.attachments [new]
-- + rls app.attachments [new]
-- + rls app.profiles [new]
-- + policy app.attachments.attachments_read_own [new]
-- + policy app.profiles.profiles_read_own [new]
-- + view app.profiles_public [new]
-- + grant app.all-tables-privileges.anon [new]
-- + grant app.all-tables-privileges.authenticated [new]
-- + grant app.default-table-privileges.anon [new]
-- + grant app.default-table-privileges.authenticated [new]
-- + grant app.schema-usage.anon [new]
-- + grant app.schema-usage.authenticated [new]
-- + supabase-storage-bucket attachments [new]
-- parent-snapshot: sha256:d369ef9ab960e03f29326874197ae3d23281b0b38fa322e6e8d0b9ac9030eedb
-- snapshot: sha256:5b7eca272eec78d30655af2c7cc982fce5e3f989e84b58d43d891cfa588a3448

create schema "app";

create table "app"."drafts" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	constraint "drafts_pkey" primary key ("id")
);

create table "app"."profiles" (
	"id" uuid not null default gen_random_uuid(),
	"user_id" uuid not null,
	"display_name" text not null,
	constraint "profiles_pkey" primary key ("id")
);

create table "app"."attachments" (
	"id" uuid not null default gen_random_uuid(),
	"profile_id" uuid not null,
	"storage_path" text not null,
	"size_bytes" bigint not null,
	constraint "attachments_pkey" primary key ("id"),
	constraint "attachments_size_bytes_positive" check ("attachments"."size_bytes" > 0)
);

alter table "app"."attachments" enable row level security;

alter table "app"."profiles" enable row level security;

drop policy if exists "attachments_read_own" on "app"."attachments";

create policy "attachments_read_own" on "app"."attachments" for select to "authenticated" using (exists (select 1 from "app"."profiles" where ("profiles"."id" = "attachments"."profile_id") and ("profiles"."user_id" = (select auth.uid()))));

drop policy if exists "profiles_read_own" on "app"."profiles";

create policy "profiles_read_own" on "app"."profiles" for select to "authenticated" using ("profiles"."user_id" = (select auth.uid()));

create or replace view "app"."profiles_public" as select "id", "user_id", "display_name" from "app"."profiles";

grant select on all tables in schema "app" to "anon";

grant select on all tables in schema "app" to "authenticated";

alter default privileges in schema "app" grant select on tables to "anon";

alter default privileges in schema "app" grant select on tables to "authenticated";

grant usage on schema "app" to "anon";

grant usage on schema "app" to "authenticated";

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";

alter table "app"."profiles" add constraint "profiles_user_id_fk" foreign key ("user_id") references "auth"."users" ("id");

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id");
