---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

The `unknown-kind` error now tells apart two different causes instead of
always suggesting a missing preset. When the unregistered kind id looks
like one of hejbro's own (a bare word, no namespace prefix -- `sequence`,
not `supabase-storage-bucket`), the message now says the snapshot was
likely written by a newer hejbro and suggests upgrading, instead of
sending the reader to register a preset that does not exist (#196).
