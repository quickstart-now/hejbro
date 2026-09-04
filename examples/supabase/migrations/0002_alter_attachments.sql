-- hejbro migration
-- ~ table app.attachments [column "content_type" added, check "attachments_content_type_allowed" added]
-- ~ supabase-storage-bucket attachments [allowed mime types changed]
-- parent-snapshot: sha256:5b7eca272eec78d30655af2c7cc982fce5e3f989e84b58d43d891cfa588a3448
-- snapshot: sha256:3616085aa982e780353d47d9c9478bd97f3839e9f92b06452d5618034275342a

alter table "app"."attachments" add column "content_type" text;

alter table "app"."attachments" add constraint "attachments_content_type_allowed" check ("attachments"."content_type" in ('image/png', 'image/jpeg'));

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
