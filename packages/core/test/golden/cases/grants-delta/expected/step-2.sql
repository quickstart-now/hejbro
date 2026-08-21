-- hejbro migration
-- - grant app.default-table-privileges.anon [dropped]

alter default privileges in schema "app" revoke select on tables from "anon";