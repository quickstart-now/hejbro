---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

The `unknown-kind` error no longer always suggests a missing preset,
which was actively wrong for a snapshot written by a newer hejbro (a
core kind this build predates, e.g. a future `sequence` kind, #23) --
no preset could ever provide it, so the advice sent readers hunting
for one that doesn't exist. The message now says so explicitly for any
unrecognized kind id, alongside the original "check your presets"
advice, since this build can't always tell the two causes apart
(#196).
