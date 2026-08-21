-- hejbro migration
-- - grant app.defaultTablePrivileges.anon [dropped]

alter default privileges in schema "app" revoke select on tables from "anon";