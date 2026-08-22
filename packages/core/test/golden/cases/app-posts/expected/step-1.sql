-- hejbro migration
-- ~ table app.posts [column "slug" added]

alter table "app"."posts" add column "slug" text not null constraint "posts_slug_key" unique;