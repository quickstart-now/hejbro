-- hejbro migration
-- ~ table app.docs [index "docs_data_idx" changed]

drop index "app"."docs_data_idx";

create index "docs_data_idx" on "app"."docs" using gin ("data");