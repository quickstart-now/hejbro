-- hejbro migration
-- ~ grant ddland.allTablesPrivileges.anon [+insert]
-- ~ grant ddland.allTablesPrivileges.service_role [-delete]

grant insert on all tables in schema "ddland" to "anon";

revoke delete on all tables in schema "ddland" from "service_role";