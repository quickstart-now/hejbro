-- hejbro migration
-- ~ table app.posts [column "id" dropped]
-- - sequence app.posts_id_seq [dropped]

alter table "app"."posts" alter column "id" drop default;

drop sequence "app"."posts_id_seq";

alter table "app"."posts" drop column "id";