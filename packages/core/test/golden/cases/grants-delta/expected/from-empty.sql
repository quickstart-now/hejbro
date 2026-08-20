-- hejbro migration
-- + schema app [new]
-- + grant app.allTablesPrivileges.anon [new]
-- + grant app.allTablesPrivileges.service_role [new]
-- + grant app.defaultTablePrivileges.anon [new]
-- + grant app.schemaUsage.anon [new]
-- + grant app.schemaUsage.service_role [new]

create schema "app";

grant select on all tables in schema "app" to "anon";

grant select, insert, update, delete on all tables in schema "app" to "service_role";

alter default privileges in schema "app" grant select on tables to "anon";

grant usage on schema "app" to "anon";

grant usage on schema "app" to "service_role";