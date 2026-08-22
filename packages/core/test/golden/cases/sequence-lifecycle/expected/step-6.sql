-- hejbro migration
-- + sequence app.posts_id_seq [new]
-- ~ table app.posts [column "id" added]

create sequence "app"."posts_id_seq" as integer;

alter table "app"."posts" add column "id" integer not null default nextval('app.posts_id_seq');

alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";