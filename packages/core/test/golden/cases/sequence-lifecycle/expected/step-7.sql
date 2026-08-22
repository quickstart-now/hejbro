-- hejbro migration
-- - table app.posts [dropped]
-- - sequence app.posts_id_seq [dropped]

alter table "app"."posts" alter column "id" drop default;

drop sequence "app"."posts_id_seq";

drop table "app"."posts";