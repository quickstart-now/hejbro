-- hejbro migration
-- ~ table app.post_tags [column "tag_slug" changed]

alter table "app"."post_tags" drop constraint "post_tags_pkey";

alter table "app"."post_tags" add constraint "post_tags_pkey" primary key ("post_id", "tag_slug");