-- hejbro migration
-- - grant app.default-table-privileges.service_role [dropped]
-- - policy app.posts.posts_insert_draft_only [dropped]

drop policy "posts_insert_draft_only" on "app"."posts";

alter default privileges in schema "app" revoke select, insert, update, delete on tables from "service_role";