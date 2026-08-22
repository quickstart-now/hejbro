-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:e48de0b944372a973375ce40cfa46c751b529cd40fa66a0b516824b8b6b3a5c9
-- snapshot: sha256:87309be8bdd2bcc0a65b58d3a1656cdeba17b42c953d1d0be55d81bde28ac7ce

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
