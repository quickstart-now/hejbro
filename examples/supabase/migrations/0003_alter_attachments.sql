-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:42d872ac31f507e3556d0ce803ab6288f75e9eb44e3ab6ba9faaba60718ac1f9
-- snapshot: sha256:f15fa5cebc9e6e01847b0e0a37acaa408a8aad8b6f42ee7f0118e1f17a0a1dcd

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
