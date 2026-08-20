-- roundtrip seed: the Supabase-isms a generic Postgres lacks.
-- Roles: modeled on supabase/storage migrations/tenant/0002-storage-schema.sql
-- (CREATE ROLE … NOLOGIN NOINHERIT; service_role additionally BYPASSRLS).
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'anon') then
		create role anon nologin noinherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'authenticated') then
		create role authenticated nologin noinherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'service_role') then
		create role service_role nologin noinherit bypassrls;
	end if;
end
$$;

-- storage.buckets stub: only the columns hejbro's bucket upsert touches
-- (packages/supabase/src/storage/bucket-kind.ts), with per-column sources:
create schema if not exists storage;          -- 0002-storage-schema.sql

create table if not exists storage.buckets (
	id text not null primary key,               -- 0002-storage-schema.sql (PK — target of the upsert's on conflict ("id"))
	name text not null,                         -- 0002-storage-schema.sql
	public boolean default false,               -- 0008-add-public-to-buckets.sql
	file_size_limit bigint,                     -- 0013 (max_file_size_kb int) → 0014-use-bytes-for-max-size.sql (rename + bigint)
	allowed_mime_types text[]                   -- 0013-add-bucket-custom-limits.sql
);
create unique index if not exists bname
	on storage.buckets (name);                  -- 0002-storage-schema.sql

-- auth.users stub: only the column `authUsers` (D41) references as an FK target.
create schema if not exists auth;
create table if not exists auth.users (id uuid not null primary key);
