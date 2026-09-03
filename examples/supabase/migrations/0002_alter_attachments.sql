-- hejbro migration
-- ~ table app.attachments [column "content_type" added, check "attachments_content_type_allowed" added]
-- ~ supabase-storage-bucket attachments [allowed mime types changed]
-- parent-snapshot: sha256:5b7eca272eec78d30655af2c7cc982fce5e3f989e84b58d43d891cfa588a3448
-- snapshot: sha256:bba33a1a710365bbbff7f1e67001959517a8c1439ec8ea31e2f64ab946c761d3

alter table "app"."attachments" add column "content_type" text;

alter table "app"."attachments" add constraint "attachments_content_type_allowed" check ("app"."attachments"."content_type" in ('image/png', 'image/jpeg'));

insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
