-- hejbro migration
-- ~ table ddland.comments [foreign key "comments_post_id_fk" added]
-- ~ table ddland.posts [index "posts_published_at_idx" dropped]

drop index "ddland"."posts_published_at_idx";

alter table "ddland"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "ddland"."posts" ("id") on delete cascade;