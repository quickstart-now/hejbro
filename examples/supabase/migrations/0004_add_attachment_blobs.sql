-- hejbro migration
-- + table app.attachment_blobs [new]
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:f15fa5cebc9e6e01847b0e0a37acaa408a8aad8b6f42ee7f0118e1f17a0a1dcd
-- snapshot: sha256:80b5f9a8455cd90a483774d0809a4d2a57f6af24b25bdd5781fd551ae07a6dd2

create table "app"."attachment_blobs" (
	"attachment_id" uuid not null,
	"storage_path" text not null,
	"checksum" text not null,
	constraint "attachment_blobs_pkey" primary key ("attachment_id")
);

grant select on all tables in schema "app" to "anon";

grant select on all tables in schema "app" to "authenticated";

alter table "app"."attachments" drop column "storage_path";

alter table "app"."attachments" add column "archived_at" timestamp with time zone;

alter table "app"."attachment_blobs" enable row level security;

drop policy if exists "attachment_blobs_read_own" on "app"."attachment_blobs";

create policy "attachment_blobs_read_own" on "app"."attachment_blobs" for select to "authenticated" using (exists (select 1 from "app"."attachments" inner join "app"."profiles" on "app"."profiles"."id" = "app"."attachments"."profile_id" where ("app"."attachments"."id" = "app"."attachment_blobs"."attachment_id") and ("app"."profiles"."user_id" = (select auth.uid()))));

alter table "app"."attachment_blobs" add constraint "attachment_blobs_attachment_id_fk" foreign key ("attachment_id") references "app"."attachments" ("id") on delete cascade;
