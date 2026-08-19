-- hejbro migration
-- ~ view ddland.published_posts [view columns changed; recreating]

drop view if exists "ddland"."published_posts";

create or replace view "ddland"."published_posts" as select "ddland"."posts"."id" as "id", "ddland"."posts"."status" as "status" from "ddland"."posts";