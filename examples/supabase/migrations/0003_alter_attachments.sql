-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:40397c7ab1d5dd667efa6a8f17e6dd93c9f1280156e83cb4bd34620541e1b66d
-- snapshot: sha256:9cddb0234a8f25e768f9e2c5d2e315f70c54a461235721f0f4ab3162ad2c99ce

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
