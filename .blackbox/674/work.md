# Work — quickstart-now/hejbro#674

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — auth.users declared as existing in examples/supabase

_2026-09-05T08:45Z_

Measured: the loader collects a module's *named* exports and never reads the `declarations` array, so the preset's `authUsers` had to be re-exported from `app.schema.ts` (documented at the export). `generate` then writes a banner-only migration `0005_record_users.sql` (no DDL) and records `auth.users` as existing in the snapshot. `scripts/check-declared-vs-catalog.mjs` gained the existing-table rule (`hejbro check`'s own coverage rule): presence asserted, columns not compared, one skip line — before it, the seed stub's missing `email` column failed the chain leg. The seed stub now carries the two columns the preset declares. Verified: supabase and postgres round trips green; `hejbro check` against the seeded chain exits 0 and prints "check does not compare auth.users: declared existing and not compared."

