-- hejbro migration
-- - grant ddland.defaultTablePrivileges.anon [dropped]

alter default privileges in schema "ddland" revoke select on tables from "anon";