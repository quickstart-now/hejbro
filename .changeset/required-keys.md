---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

`ObjectKind` gains an optional `requiredKeys?: ReadonlyArray<string>` —
every built-in core kind (and `@hejbro/supabase`'s storage-bucket kind)
now declares its own snapshot node's mandatory top-level keys.
`parseSnapshot` takes an optional second argument, a plain
`ReadonlyMap<string, ReadonlyArray<string>>` built by the new
`requiredKeysByKind(registry)` helper — when given, a hand-edited or
corrupted snapshot entry missing one of its own kind's required keys is
now reported by kind and key name at parse time, before the diff engine
crashes on the `undefined` field downstream instead. Omitting the second
argument (every pre-#159 call site) keeps `parseSnapshot`'s prior
behavior unchanged. Follow-up to #26/PR #152's deferred "option 3".
