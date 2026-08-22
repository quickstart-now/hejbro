-- hejbro migration
-- - policy app.comments.comments_read_visible [dropped]
-- - rls app.comments [dropped]

drop policy "comments_read_visible" on "app"."comments";

alter table "app"."comments" disable row level security;