-- hejbro migration
-- ~ table ddland.posts [column "slug" added]

alter table "ddland"."posts" add column "slug" text not null unique;