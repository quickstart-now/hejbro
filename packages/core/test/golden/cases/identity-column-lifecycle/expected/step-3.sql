-- hejbro migration
-- ~ table app.widgets [column "count" changed]

alter table "app"."widgets" alter column "count" drop identity;

alter table "app"."widgets" alter column "count" drop not null;