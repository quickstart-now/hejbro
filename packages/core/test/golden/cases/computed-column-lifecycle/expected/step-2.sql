-- hejbro migration
-- ~ table app.widgets [column "total" changed]

alter table "app"."widgets" alter column "total" drop expression;