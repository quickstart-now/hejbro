select id, name, public, file_size_limit, array_to_string(allowed_mime_types, ',') from storage.buckets order by id;
