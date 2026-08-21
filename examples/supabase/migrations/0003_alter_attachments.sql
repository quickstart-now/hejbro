-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:3170a63fe866eefe48f9a94a4196dd1c0fa115b1a8ed57a0e063d56d122d0157
-- snapshot: sha256:44352ec651dab4f79bd0d25194c8aacf907cdfc7d06cd5f6061a6eb943759b68

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
