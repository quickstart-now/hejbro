-- hejbro migration
-- ~ view app.published_posts [view columns changed; recreating]

drop view if exists "app"."published_posts";

create or replace view "app"."published_posts" as select "app"."posts"."id" as "id", "app"."posts"."status" as "status" from "app"."posts";