-- hejbro migration
-- ~ table app.widgets [column "total" changed]

alter table "app"."widgets" drop column "total";

alter table "app"."widgets" add column "total" numeric generated always as (price * qty * 2) stored;