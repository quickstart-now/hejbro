-- hejbro migration
-- ~ table app.users [column "email" renamed to "email_address"]

alter table "app"."users" rename column "email" to "email_address";