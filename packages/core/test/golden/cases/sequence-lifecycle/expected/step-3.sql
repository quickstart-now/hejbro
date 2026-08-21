-- hejbro migration
-- ~ table app.posts [column "id" changed]
-- - sequence app.posts_id_seq [dropped]

alter table "app"."posts" alter column "id" type integer;

alter table "app"."posts" alter column "id" drop default;

drop sequence "app"."posts_id_seq";