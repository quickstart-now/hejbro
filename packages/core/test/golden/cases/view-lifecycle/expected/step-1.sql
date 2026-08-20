-- hejbro migration
-- ~ view app.published_posts [view changed]

create or replace view "app"."published_posts" as select "id", "status", "published_at" from "app"."posts" where ("app"."posts"."published_at" is not null) and ("app"."posts"."status" = 'published');