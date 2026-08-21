-- hejbro migration
-- ~ table app.posts [column "id" dropped]
-- - sequence app.posts_id_seq [dropped]

alter table "app"."posts" drop column "id";