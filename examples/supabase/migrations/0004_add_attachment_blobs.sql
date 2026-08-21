-- hejbro migration
-- + table app.attachment_blobs [new]
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:cef7799ccbe17f2350308bbd22838f190f48a24279a55c49306dac624f245237
-- snapshot: sha256:230fa05b3060dc24b5fc3085e781cab13a636b7c8a644b383a61ef453ddde8f9

create table "app"."attachment_blobs" (
	"attachment_id" uuid not null,
	"storage_path" text not null,
	"checksum" text not null,
	primary key ("attachment_id")
);

alter table "app"."attachments" drop column "storage_path";

alter table "app"."attachments" add column "archived_at" timestamp with time zone;

alter table "app"."attachment_blobs" enable row level security;

drop policy if exists "attachment_blobs_read_own" on "app"."attachment_blobs";

create policy "attachment_blobs_read_own" on "app"."attachment_blobs" for select to "authenticated" using (exists (select 1 from "app"."attachments" inner join "app"."profiles" on "app"."profiles"."id" = "app"."attachments"."profile_id" where ("app"."attachments"."id" = "app"."attachment_blobs"."attachment_id") and ("app"."profiles"."user_id" = auth.uid())));

alter table "app"."attachment_blobs" add constraint "attachment_blobs_attachment_id_fk" foreign key ("attachment_id") references "app"."attachments" ("id") on delete cascade;
