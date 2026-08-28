-- hejbro migration
-- + table app.attachment_blobs [new]
-- ~ table app.attachments [column "archived_at" added, column "storage_path" dropped]
-- + rls app.attachment_blobs [new]
-- + policy app.attachment_blobs.attachment_blobs_read_own [new]
-- parent-snapshot: sha256:25395646ba2a11bd2faece5a27eb78fea5fbaf41319ce5dd435876e37b3d2973
-- snapshot: sha256:54cd24845bb88ffb28c00bef1dcbba83565da5d031650ce8952c3d8c2941aaf8

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
