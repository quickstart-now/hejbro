-- hejbro migration
-- + schema app [new]
-- + table app.attachments [new]
-- + table app.drafts [new]
-- + table app.profiles [new]
-- + rls app.attachments [new]
-- + rls app.profiles [new]
-- + policy app.attachments.attachments_read_own [new]
-- + policy app.profiles.profiles_read_own [new]
-- + view app.profiles_public [new]
-- + grant app.allTablesPrivileges.anon [new]
-- + grant app.allTablesPrivileges.authenticated [new]
-- + grant app.defaultTablePrivileges.anon [new]
-- + grant app.defaultTablePrivileges.authenticated [new]
-- + supabase-storage-bucket attachments [new]
-- parent-snapshot: sha256:f86ae7ebc6d8bd93524149ab39f929814ff7413a6e5e1cfdb1d21367bf9bd295
-- snapshot: sha256:9bcb44dc93fa255414e6b11ec3c67e5525ae7f015ee5b5e55193fe2039efa81e

create schema "app";

create table "app"."attachments" (
	"id" uuid not null default gen_random_uuid(),
	"profile_id" uuid not null,
	"storage_path" text not null,
	"size_bytes" bigint not null,
	primary key ("id"),
	constraint "attachments_size_bytes_positive" check ("app"."attachments"."size_bytes" > 0)
);

create table "app"."drafts" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	primary key ("id")
);

create table "app"."profiles" (
	"id" uuid not null default gen_random_uuid(),
	"user_id" uuid not null,
	"display_name" text not null,
	primary key ("id")
);

alter table "app"."attachments" enable row level security;

alter table "app"."profiles" enable row level security;

drop policy if exists "attachments_read_own" on "app"."attachments";

create policy "attachments_read_own" on "app"."attachments" for select to "authenticated" using (exists (select 1 from "app"."profiles" where ("app"."profiles"."id" = "app"."attachments"."profile_id") and ("app"."profiles"."user_id" = auth.uid())));

drop policy if exists "profiles_read_own" on "app"."profiles";

create policy "profiles_read_own" on "app"."profiles" for select to "authenticated" using ("app"."profiles"."user_id" = auth.uid());

create or replace view "app"."profiles_public" as select "id", "user_id", "display_name" from "app"."profiles";

grant select on all tables in schema "app" to "anon";

grant select on all tables in schema "app" to "authenticated";

alter default privileges in schema "app" grant select on tables to "anon";

alter default privileges in schema "app" grant select on tables to "authenticated";

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id");

alter table "app"."profiles" add constraint "profiles_user_id_fk" foreign key ("user_id") references "auth"."users" ("id");
