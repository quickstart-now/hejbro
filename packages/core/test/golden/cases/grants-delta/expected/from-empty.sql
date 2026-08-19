-- hejbro migration
-- + schema ddland [new]
-- + grant ddland.allTablesPrivileges.anon [new]
-- + grant ddland.allTablesPrivileges.service_role [new]
-- + grant ddland.defaultTablePrivileges.anon [new]
-- + grant ddland.schemaUsage.anon [new]
-- + grant ddland.schemaUsage.service_role [new]

create schema "ddland";

grant select on all tables in schema "ddland" to "anon";

grant select, insert, update, delete on all tables in schema "ddland" to "service_role";

alter default privileges in schema "ddland" grant select on tables to "anon";

grant usage on schema "ddland" to "anon";

grant usage on schema "ddland" to "service_role";