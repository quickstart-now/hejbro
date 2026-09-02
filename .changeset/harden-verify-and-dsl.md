---
"@hejbro/core": patch
"hejbro": patch
---

Four fixes (#677):

- `hejbro verify`'s `chain-tip-mismatch` now names the migration file
  whose `snapshot:` hash is the chain tip and the snapshot path it
  disagrees with, instead of misreading the message's own quoted
  `"snapshot:"` substring as the identity (#632).
- `synced-function-declared` (a synthesized function declaration reaching
  `generate`) is now specified and documented, mirroring the existing
  table guard (#658, function half) — the error text itself was already
  correct.
- A column-level `.references(() => target.column)` thunk no longer runs
  during `table()` itself — it resolves on the declaration's first
  `foreignKeys` read instead, so two declaration files (or two tables in
  one file) that reference each other now load under either order,
  including a genuine circular import between two schema files. Previously
  this crashed with a TDZ error (same file) or "Cannot read properties of
  undefined" (cross-file), regardless of which side was declared first
  (#669).
- `ctx.return` now accepts a mutation ending in a projected
  `.returning({...})`, exactly as it already accepted the bare
  `.returning()` form — the rendered `return query ...` carries exactly
  the projected `RETURNING` list (#634).
