-- hejbro migration
-- - policy ddland.comments.comments_read_visible [dropped]
-- - rls ddland.comments [dropped]

drop policy if exists "comments_read_visible" on "ddland"."comments";

alter table "ddland"."comments" disable row level security;