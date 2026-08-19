-- hejbro migration
-- ~ view ddland.published_posts [view changed]

create or replace view "ddland"."published_posts" as select "id", "status", "published_at" from "ddland"."posts" where ("ddland"."posts"."published_at" is not null) and ("ddland"."posts"."status" = 'published');