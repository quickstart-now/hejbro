-- Roles are cluster-level objects, outside hejbro's declarations: hejbro manages grants and RLS but never CREATE ROLE, so the roles a schema grants to must exist before its migrations run. Your platform or DBA creates them; here the round-trip does.
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'app_reader') then
		create role app_reader nologin;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'app_writer') then
		create role app_writer nologin;
	end if;
	-- #121: only ever granted a one-shot all-tables-privileges grant, no
	-- matching defaultPrivileges — app_reader/app_writer above both have
	-- one, which would otherwise mask the defect this role's grant exists
	-- to prove (see step-6.schema.ts's appAuditorSelectGrant).
	if not exists (select 1 from pg_roles where rolname = 'app_auditor') then
		create role app_auditor nologin;
	end if;
end
$$;
