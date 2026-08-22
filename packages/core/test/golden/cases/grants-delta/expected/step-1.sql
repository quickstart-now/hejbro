-- hejbro migration
-- ~ grant app.all-tables-privileges.anon [+insert]
-- ~ grant app.all-tables-privileges.service_role [-delete]

grant insert on all tables in schema "app" to "anon";

revoke delete on all tables in schema "app" from "service_role";