-- hejbro migration
-- + table app.attachment_blobs [new]
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:ef0cd9caf013e83d33434d22b80a4e5597d01a6d6f53877357d25b9ad67d4587
-- snapshot: sha256:afcd7c611b4b98cfa3a580d3149f1981d6227129fdb415fb03b15d3bd04a320b

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
