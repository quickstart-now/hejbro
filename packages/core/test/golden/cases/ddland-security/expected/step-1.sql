-- hejbro migration
-- ~ policy ddland.posts.posts_read_published [policy changed; recreating]
-- ~ grant ddland.allTablesPrivileges.anon [+insert]

drop policy if exists "posts_read_published" on "ddland"."posts";

create policy "posts_read_published" on "ddland"."posts" for select to "anon" using ("ddland"."posts"."status" = 'published');

grant insert on all tables in schema "ddland" to "anon";