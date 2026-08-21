-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:cc69fca7f430caee85e1f7d8eae56bd6e68103362bfdff883d344d4f97497ad1
-- snapshot: sha256:085b82eb8804e8f1128c849ba7af6b033dd144521a3532a3637693fbe720bc9e

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
