-- hejbro migration
-- ~ table app.attachments [column "content_type" added, check "attachments_content_type_allowed" added]
-- ~ supabase-storage-bucket attachments []
-- parent-snapshot: sha256:3e83f650958435f96dcb366650263ef686dc1c6e1d682e108351447c92ecf90c
-- snapshot: sha256:ff7bfc2a548b6dd4f4ead7abdaaa1c1e6179ae72da700a9159a965c9e18172e5

alter table "app"."attachments" add column "content_type" text;

alter table "app"."attachments" add constraint "attachments_content_type_allowed" check ("app"."attachments"."content_type" in ('image/png', 'image/jpeg'));

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
