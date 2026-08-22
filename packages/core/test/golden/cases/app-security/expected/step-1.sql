-- hejbro migration
-- ~ policy app.posts.posts_read_published [policy changed; recreating]
-- ~ grant app.all-tables-privileges.anon [+insert]

drop policy "posts_read_published" on "app"."posts";

create policy "posts_read_published" on "app"."posts" for select to "anon" using ("app"."posts"."status" = 'published');

grant insert on all tables in schema "app" to "anon";