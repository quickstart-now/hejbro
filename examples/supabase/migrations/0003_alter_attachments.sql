-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:df700b87ddbe34b9c9e4625b74bd91ca2a2a7eeee99fd7d5fe4d1789dac4121a
-- snapshot: sha256:c0f061001a2e1c7103903d48acc85be7ae94d412e1c6508939d126dcbb31e5f7

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
