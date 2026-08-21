-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:a5b49f39e90db92d8ecf1151ed4b246ace595c11ff56b0b82065cb15745336bb
-- snapshot: sha256:cef7799ccbe17f2350308bbd22838f190f48a24279a55c49306dac624f245237

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
