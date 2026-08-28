-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:18333f3754514254de275f1fa2a0990eed47ba540e1f42b4f812384727ba9650
-- snapshot: sha256:25395646ba2a11bd2faece5a27eb78fea5fbaf41319ce5dd435876e37b3d2973

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
