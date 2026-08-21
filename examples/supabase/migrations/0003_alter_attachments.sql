-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:752c1837d34d4a6077e96f377eed1bdedc4e71a52ee890bd05970500ea66644e
-- snapshot: sha256:00ed3d3867be6b741829328e4dd0e973488887f1407207e39d3af53ed36a99d2

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
