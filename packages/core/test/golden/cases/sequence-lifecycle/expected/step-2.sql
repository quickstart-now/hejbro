-- hejbro migration
-- ~ sequence app.posts_id_seq [base type changed]
-- ~ table app.posts [column "id" changed]

alter sequence "app"."posts_id_seq" as bigint;

alter table "app"."posts" alter column "id" type bigint;