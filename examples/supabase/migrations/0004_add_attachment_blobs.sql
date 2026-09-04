-- hejbro migration
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + table app.attachment_blobs [new]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:e5728863ddd181a548983be51af974daa0fd8051f26f97bdf3dd75aa7af60c8b
-- snapshot: sha256:8ddd39752cdac52e58122e3ea13dad1fae101e67512895a36c330a939876bc6c

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
