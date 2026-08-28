-- hejbro migration
-- ~ table app.widgets [column "count" changed]

alter table "app"."widgets" alter column "count" set not null;

alter table "app"."widgets" alter column "count" add generated always as identity;