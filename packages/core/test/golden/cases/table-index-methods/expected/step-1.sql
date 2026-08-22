-- hejbro migration
-- ~ table app.docs [index "docs_data_idx" changed]
-- ~ table app.users [index "users_email_lower_idx" changed]

drop index "app"."docs_data_idx";

create index "docs_data_idx" on "app"."docs" using gin ("data");

drop index "app"."users_email_lower_idx";

create index "users_email_lower_idx" on "app"."users" (lower(btrim("app"."users"."email")));