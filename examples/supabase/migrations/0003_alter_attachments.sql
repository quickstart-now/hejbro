-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:bba33a1a710365bbbff7f1e67001959517a8c1439ec8ea31e2f64ab946c761d3
-- snapshot: sha256:318b8e47983030f4d832cbfad27d66db00b8254a1fd8d3cac049da5ce135ec1e

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
