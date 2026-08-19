-- hejbro migration
-- - grant ddland.defaultTablePrivileges.service_role [dropped]
-- - policy ddland.posts.posts_insert_draft_only [dropped]

alter default privileges in schema "ddland" revoke select, insert, update, delete on tables from "service_role";

drop policy if exists "posts_insert_draft_only" on "ddland"."posts";