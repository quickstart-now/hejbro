-- hejbro migration
-- ~ grant app.allTablesPrivileges.anon [+insert]
-- ~ grant app.allTablesPrivileges.service_role [-delete]

grant insert on all tables in schema "app" to "anon";

revoke delete on all tables in schema "app" from "service_role";