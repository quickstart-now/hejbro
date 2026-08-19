-- hejbro migration
-- ~ rls ddland.posts [force row level security]
-- ~ policy ddland.posts.posts_read_published [policy changed; recreating]

alter table "ddland"."posts" force row level security;

drop policy if exists "posts_read_published" on "ddland"."posts";

create policy "posts_read_published" on "ddland"."posts" for select to "anon" using ("ddland"."posts"."published_at" is not null);