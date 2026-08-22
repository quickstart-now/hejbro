-- hejbro migration
-- + sequence app.posts_id_seq [new]

create sequence "app"."posts_id_seq" as integer;

alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";

alter table "app"."posts" alter column "id" set default nextval('app.posts_id_seq');