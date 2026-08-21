---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Adding a `.primaryKey()` column to an existing table, or dropping a
column out of a composite primary key while another column still
declares `.primaryKey()`, now fails loudly with `unsupported-column-
alter` instead of silently emitting incomplete SQL (#137).

Both paths were real defects, not just missing features:

- **Add path**: `renderColumnDefinition` (used for `add column`) never
  emitted a `primary key` clause -- that's a `create table`-only,
  table-level concern -- so `alter table … add column "x" uuid not
  null;` looked plausible while the constraint itself never appeared.
- **Drop path**: dropping one column of a composite primary key drops
  the *entire* constraint on Postgres's side, with no warning
  (confirmed directly against a real Postgres) -- silently leaving any
  surviving `.primaryKey()` column without one, so a chain-built
  database and a fresh build of the same declaration disagree.

This is a smaller, standalone fix -- `phase8-constraint-names` (#24)
replaces this guard with the real `add constraint`/`drop constraint`
emission for both paths. Landing the guard first means the silent
corruption is closed even if `phase8-constraint-names` takes longer.
