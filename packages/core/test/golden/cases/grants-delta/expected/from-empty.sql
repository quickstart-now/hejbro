-- hejbro migration
-- + schema app [new]
-- + grant app.all-tables-privileges.anon [new]
-- + grant app.all-tables-privileges.service_role [new]
-- + grant app.default-table-privileges.anon [new]
-- + grant app.schema-usage.anon [new]
-- + grant app.schema-usage.service_role [new]

create schema "app";

grant select on all tables in schema "app" to "anon";

grant select, insert, update, delete on all tables in schema "app" to "service_role";

alter default privileges in schema "app" grant select on tables to "anon";

grant usage on schema "app" to "anon";

grant usage on schema "app" to "service_role";