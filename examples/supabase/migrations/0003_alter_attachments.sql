-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:22819728eec69becc1b1614432bca20fce79337e8243ae20aeb3af21d49619c3
-- snapshot: sha256:7e26394ccdf5fdeb4b66eda72ffef87a2be088acfcb21a908ed20c2307f1f839

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
