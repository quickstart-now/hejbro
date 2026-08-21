-- hejbro migration
-- ~ table app.attachments [column "content_type" added, check "attachments_content_type_allowed" added]
-- ~ supabase-storage-bucket attachments []
-- parent-snapshot: sha256:b162f153635d0425faa185c79f3a6a2bd9fdfec28a3dea99f8aa456e233fcdc0
-- snapshot: sha256:40397c7ab1d5dd667efa6a8f17e6dd93c9f1280156e83cb4bd34620541e1b66d

alter table "app"."attachments" add column "content_type" text;

alter table "app"."attachments" add constraint "attachments_content_type_allowed" check ("app"."attachments"."content_type" in ('image/png', 'image/jpeg'));

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
