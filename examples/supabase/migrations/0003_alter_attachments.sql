-- hejbro migration
-- ~ table app.attachments [foreign key "attachments_profile_id_fk" changed]
-- parent-snapshot: sha256:5d16b914bb2ef5ce0e127d0f9db82e8ab92b1f13dd76840f566c03afedc773cb
-- snapshot: sha256:6d3eb0065251441e215bbbeae5f65657535e640a2023c21dc5f56312ad294f0d

alter table "app"."attachments" drop constraint "attachments_profile_id_fk";

alter table "app"."attachments" add constraint "attachments_profile_id_fk" foreign key ("profile_id") references "app"."profiles" ("id") on delete cascade on update cascade;
