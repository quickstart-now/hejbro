-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:ff7bfc2a548b6dd4f4ead7abdaaa1c1e6179ae72da700a9159a965c9e18172e5
-- snapshot: sha256:ef0cd9caf013e83d33434d22b80a4e5597d01a6d6f53877357d25b9ad67d4587

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
