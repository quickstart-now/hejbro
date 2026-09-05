-- roundtrip seed: the Supabase-isms a generic Postgres lacks.
-- Roles: NOLOGIN INHERIT (service_role additionally BYPASSRLS) --
-- measured directly against a real supabase/postgres:17.6.1.165 container
-- (2026-08-22, phase8-supabase-image), not modeled from reading migration
-- source as the prior version of this file was:
--   select rolname, rolcanlogin, rolinherit, rolbypassrls from pg_roles
--   where rolname in ('anon','authenticated','service_role');
--       rolname    | rolcanlogin | rolinherit | rolbypassrls
--    ---------------+-------------+------------+--------------
--     anon          | f           | t          | f
--     authenticated | f           | t          | f
--     service_role  | f           | t          | t
-- (this file previously created them NOLOGIN NOINHERIT -- INHERIT is what
-- the real image actually ships.)
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'anon') then
		create role anon nologin inherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'authenticated') then
		create role authenticated nologin inherit;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'service_role') then
		create role service_role nologin inherit bypassrls;
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

-- auth.users stub: the two columns the preset's `authUsers` declares (D41,
-- #674) -- `id` as the FK target, `email` as the shape a consumer reads.
create schema if not exists auth;
create table if not exists auth.users (id uuid not null primary key, email text);

-- auth.uid() stub: the RLS policies built with authUid() call this at
-- policy-creation time (it just needs to exist with the right signature —
-- the round-trip only diffs schema, never queries through RLS as a real
-- session). Body copied verbatim from a real supabase/postgres:17.6.1.165
-- container (2026-08-22, phase8-supabase-image), not modeled from reading
-- migration source as the prior version of this file was:
--   \sf auth.uid
--     CREATE OR REPLACE FUNCTION auth.uid()
--      RETURNS uuid
--      LANGUAGE sql
--      STABLE
--     AS $function$
--       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
--     $function$
-- (this file previously added a `coalesce` fallback onto a second
-- `request.jwt.claims` jsonb path that the real function does not have.)
-- Guarded like every other stub above: a real Supabase database already
-- has its own auth.uid(), so this must be a no-op there, never an
-- overwrite.
do $$
begin
	if not exists (
		select 1 from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'auth' and p.proname = 'uid'
	) then
		create function auth.uid() returns uuid
			language sql stable
			as $body$
			select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
		$body$;
	end if;
end
$$;
