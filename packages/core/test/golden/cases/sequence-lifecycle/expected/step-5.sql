-- hejbro migration
-- - table app.posts [dropped]
-- - sequence app.posts_id_seq [dropped]

drop table "app"."posts";

alter table if exists "app"."posts" alter column "id" drop default;

drop sequence if exists "app"."posts_id_seq";