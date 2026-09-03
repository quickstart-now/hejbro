-- hejbro migration
-- ~ table app.posts [check "posts_status_check" changed]
-- ~ table app.comments [foreign key "comments_post_id_fk" changed]

alter table "app"."comments" drop constraint "comments_post_id_fk";

alter table "app"."posts" drop constraint "posts_status_check";

alter table "app"."posts" add constraint "posts_status_check" check ("posts"."status" in ('draft', 'published', 'archived'));

alter table "app"."comments" add constraint "comments_post_id_fk" foreign key ("post_id") references "app"."posts" ("id") on delete cascade on update restrict;