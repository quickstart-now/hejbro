-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:3616085aa982e780353d47d9c9478bd97f3839e9f92b06452d5618034275342a
-- snapshot: sha256:e5728863ddd181a548983be51af974daa0fd8051f26f97bdf3dd75aa7af60c8b

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
