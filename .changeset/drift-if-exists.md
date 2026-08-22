---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

`policy` and `trigger`'s `alter`/`drop` migration steps now emit a bare
`drop policy`/`drop trigger` instead of `drop ... if exists` (D75) — an
out-of-band removal of a policy or trigger hejbro still declares now
fails loudly at the next `hejbro generate`/apply instead of silently
being re-created. The `create` path is unchanged: a first-time create
still emits the idempotent `if exists` guard, since there is no
previous snapshot identity for drift to hide behind there. Matches
`sequence`'s existing (#193) bare-drop behavior on the same two paths.
