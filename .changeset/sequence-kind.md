---
"@hejbro/core": minor
---

`serial`/`smallserial`/`bigserial` columns are now modelled properly
instead of passed through as an opaque type name (#23/D66). A new
`sequence` object kind tracks the backing sequence explicitly — the
`create sequence`, `alter sequence … owned by …`, and
`alter table … set default nextval(…)` statements `pg_dump` itself
produces for a native `serial` column (confirmed by direct comparison
against a real Postgres: structurally identical, modulo the `::regclass`
cast Postgres adds on its own read-back and the role-ownership statement
hejbro deliberately skips, consistent with its role-agnostic stance
elsewhere).

**This closes four real defects, not a cosmetic change**:

- `integer()` → `serial()` used to render `alter column … type serial;`,
  which Postgres rejects outright — `serial` is `create table`/
  `add column` sugar, never a real, storable column type. Closed
  structurally, not by a runtime guard: a `ColumnSnapshot` never stores a
  `serial`-family type past `serialize` time (it always decomposes to
  the real base type — `integer`/`smallint`/`bigint`), so the invalid
  path is unreachable from the generic type-alter path rather than
  merely rejected by one.
- `serial()` → `integer()` used to silently omit both the `drop default`
  and the sequence drop, since hejbro never tracked that the column had
  a `nextval(…)` default in the first place.
- A table or column rename left the sequence's name behind — Postgres
  does **not** rename a serial-owned sequence on its own (confirmed
  directly against a real Postgres, not assumed) — the same drift the
  existing index/foreign-key name guards already close for those two
  kinds; sequences get the matching guard.

Also: `serial`/`smallserial`/`bigserial` always imply `notNull` on the
column, independent of primary-key status (confirmed via `pg_dump`:
neither `.primaryKey()` nor `.notNull()` is needed for Postgres to make
the column not-null when it's serial-family) — a separate, narrower fix,
landed as its own commit since it holds regardless of the sequence work
above.

No format-version bump. This is harmless right now because `formatVersion`
5 has never been published (all three packages are `0.0.0`; #179 is the
first release), so no reader exists to be broken — **but that is not the
reason of record.** The reason is **D73 (#196)**: `formatVersion` tracks
field *shape*, not vocabulary; adding a core kind never bumps it, before
or after publication. An older hejbro reading a snapshot with a kind it
doesn't know fails on the kind itself, not on the format — confirmed
directly (a merge-base checkout of this repo, from before this PR,
fed a hand-built v5 snapshot with a `sequence` node: `parseSnapshot`
succeeds, `generateMigration` throws `unknown-kind`) — and #196's
`unknown-kind` diagnostic is what tells that older hejbro to upgrade.
Fixing that diagnostic's wording for a core (vs. preset) kind is out of
scope for this PR — filed separately.

No existing declaration used `serial`/`smallserial`/`bigserial` in the
first place (confirmed:
`grep -rnE '\b(serial|bigserial|smallserial)\b' packages/core/test/golden/cases examples --include="*.ts"`,
scoped to every golden case and example other than this PR's own new
`sequence-lifecycle` case, returns no matches — the plain-substring form
`grep -rn "serial" ...` over the same scope returns two, both
`serialize`/`.serialize(` false positives from an unrelated preset-smoke
fixture, which is exactly why the word-boundary form is the one that
answers this question), so there is also no *committed* snapshot this
change affects either way.
