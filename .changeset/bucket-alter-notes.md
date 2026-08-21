---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

The Supabase storage bucket kind's `alter` change now reports which
fields actually changed (`"public changed"`, `"file size limit
changed"`, `"allowed mime types changed"`) instead of an empty `notes:
[]`. Previously every bucket config change rendered a bare `-- ~
supabase-storage-bucket <name> []` in the migration banner -- the only
kind that emitted an empty notes list on an alter (#116).
