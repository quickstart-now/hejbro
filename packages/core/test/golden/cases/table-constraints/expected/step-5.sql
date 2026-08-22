-- hejbro migration
-- ~ table app.post_tags [column "tag_slug" dropped]

alter table "app"."post_tags" drop constraint "post_tags_pkey";

alter table "app"."post_tags" drop column "tag_slug";

alter table "app"."post_tags" add constraint "post_tags_pkey" primary key ("post_id");