-- hejbro migration
-- ~ table app.comments [check "comments_body_length_check" dropped]

alter table "app"."comments" drop constraint "comments_body_length_check";