-- hejbro migration
-- ~ table app.comments [foreign key "comments_post_id_fk" added]
-- ~ table app.posts [index "posts_published_at_idx" dropped]

drop index "app"."posts_published_at_idx";

alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete cascade;