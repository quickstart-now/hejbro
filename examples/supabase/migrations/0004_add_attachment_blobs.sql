-- hejbro migration
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + table app.attachment_blobs [new]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:318b8e47983030f4d832cbfad27d66db00b8254a1fd8d3cac049da5ce135ec1e
-- snapshot: sha256:e0d46be6cff9daf7c7072fb23f95d814f42bf5373f1f65c85c857bd340589a7a

alter table "app"."attachments" drop column "storage_path";

alter table "app"."attachments" add column "archived_at" timestamp with time zone;

create table "app"."attachment_blobs" (
	"attachment_id" uuid not null,
	"storage_path" text not null,
	"checksum" text not null,
	constraint "attachment_blobs_pkey" primary key ("attachment_id")
);

grant select on all tables in schema "app" to "anon";

grant select on all tables in schema "app" to "authenticated";

alter table "app"."attachment_blobs" enable row level security;

drop policy if exists "attachment_blobs_read_own" on "app"."attachment_blobs";

create policy "attachment_blobs_read_own" on "app"."attachment_blobs" for select to "authenticated" using (exists (select 1 from "app"."attachments" inner join "app"."profiles" on "profiles"."id" = "attachments"."profile_id" where ("attachments"."id" = "attachment_blobs"."attachment_id") and ("profiles"."user_id" = (select auth.uid()))));

alter table "app"."attachment_blobs" add constraint "attachment_blobs_attachment_id_fk" foreign key ("attachment_id") references "app"."attachments" ("id") on delete cascade;
