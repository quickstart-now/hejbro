-- hejbro migration
-- ~ rls app.posts [force row level security]
-- ~ policy app.posts.posts_read_published [policy changed; recreating]

drop policy "posts_read_published" on "app"."posts";

alter table "app"."posts" force row level security;

create policy "posts_read_published" on "app"."posts" for select to "anon" using ("posts"."published_at" is not null);