-- hejbro migration
-- ~ table app.posts [index "posts_status_idx" dropped]

drop index "app"."posts_status_idx";