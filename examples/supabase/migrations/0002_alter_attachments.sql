-- hejbro migration
-- ~ table app.attachments [column "content_type" added, check "attachments_content_type_allowed" added]
-- ~ supabase-storage-bucket attachments []
-- parent-snapshot: sha256:7a9c6ac6e5c7e442e6ccba9fcbb597d0711271a6da7abe799962c74ca2a2bf6b
-- snapshot: sha256:22819728eec69becc1b1614432bca20fce79337e8243ae20aeb3af21d49619c3

alter table "app"."attachments" add column "content_type" text;

alter table "app"."attachments" add constraint "attachments_content_type_allowed" check ("app"."attachments"."content_type" in ('image/png', 'image/jpeg'));

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
