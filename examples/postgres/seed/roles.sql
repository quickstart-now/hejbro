-- Roles are cluster-level objects, outside hejbro's declarations: hejbro manages grants and RLS but never CREATE ROLE, so the roles a schema grants to must exist before its migrations run. Your platform or DBA creates them; here the round-trip does.
do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'app_reader') then
		create role app_reader nologin;
	end if;
	if not exists (select 1 from pg_roles where rolname = 'app_writer') then
		create role app_writer nologin;
	end if;
end
$$;
