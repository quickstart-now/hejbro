-- hejbro migration
-- ~ table app.posts [index "posts_recent_idx" changed, index "posts_slug_published_uidx" changed]

drop index "app"."posts_recent_idx";

drop index "app"."posts_slug_published_uidx";

create index "posts_recent_idx" on "app"."posts" ("published_at" desc nulls last, "created_at");

create unique index "posts_slug_published_uidx" on "app"."posts" ("slug") where "app"."posts"."status" = 'published';