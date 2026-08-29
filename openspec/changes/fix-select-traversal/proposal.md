# Proposal: fix-select-traversal

## Why

`SelectNode` grew four fields in two days — `offset`/`distinct` (#438),
`groupBy`/`having` (#443) — and every site that traverses one is a
hand-written field list. All four fields were missed at four sites at
once (#444), because nothing forces a traversal to keep up with the node
it traverses. The failures are not cosmetic:

- literals inside `groupBy`/`having`/`distinct on` are spliced into the
  SQL text instead of becoming bind parameters, which is a direct
  violation of query-builder's "a runtime value SHALL never reach the
  compiled SQL text as text" (F1);
- a `groupBy` on a table that is not in scope renders wrong SQL instead
  of throwing `foreign-column-ref` (F2);
- a rename leaves stale identifiers behind in a stored view's `group by`,
  breaking D67's no-leftover-diff invariant (F3);
- RLS declaration-time scope checks and `@hejbro/supabase`'s
  `rls-uncached-auth-call` validator cannot see `auth.uid()` inside
  `having`/`groupBy` — a security-relevant blind spot (F5).

The same review found three neighbouring defects on the write and read
paths: a written `null` reaches a `json`/`jsonb` column as the JSON
document `'null'` rather than SQL NULL (F4), aggregate cells inside a
nested read escape the D102 at-risk cast and come back as a
plausible-but-wrong `bigint` (F6), a pre-#443 v8 snapshot raw-TypeErrors
in `decodeSelectNode` (F7), and `min`/`max` preserve their argument's
ColumnRef-ness so `index(max(t.a))` type-checks and fails at apply time
(F9).

Window functions are already in flight and will add the next field. The
point of this change is that they cannot repeat this.

## What Changes

- **One clause traversal table in core, keyed by `keyof SelectNode`.**
  `packages/core/src/expr/select-children.ts` maps every field of
  `SelectNode` to either its child expressions (with a replacement
  function that rebuilds the clause from a same-length list) or an
  explicit `noExprs(reason)` entry. Because the table's type is
  `{ [K in keyof SelectNode]: … }`, the next field added to the node
  fails to compile until it is entered — and every traversal site
  inherits it at once. Entry order is *render* order, so a site that
  needs positional ordering (bind-parameter numbering) gets it from the
  table rather than from a second hand-written list.
- **Every traversal site consumes it**: `walk.ts`'s child-expr helpers
  (F5), `render-sql.ts`'s `mentionedRefs` scope check (F2),
  `retarget.ts`'s `retargetSelectNode`/`isSelectNodeUnchanged` (F3), and
  `@hejbro/query`'s `liftSelectNode` (F1). `@hejbro/supabase`'s
  `rls-uncached-auth-call` drops its private copy of the same walk and
  consumes core's exported helpers.
- **`json`/`jsonb` writes treat `null` as SQL NULL** (F4). JSON null
  stays expressible through the documented escape hatch,
  ``sql`'null'::jsonb` ``. This is the one externally observable
  *semantic* change and the only part of the piece that carries a spec
  delta.
- **Nested reads cast at-risk aggregate cells** the way they already cast
  at-risk column refs (F6).
- **`decodeSelectNode` reads a pre-extension v8 snapshot leniently** —
  a missing clause field decodes to its empty value, a present but
  malformed one keeps failing with a coded diagnostic, and neither
  raw-TypeErrors (F7). The rule this establishes, stated once here
  because it outlives this change: **v8 is the superset of its
  absence-tolerant clause fields.** A snapshot version that was extended
  *in place* — v8 gained `offset`/`distinct` (#438) and
  `groupBy`/`having` (#443) without a version bump — must read every
  file ever written as that version, so those four fields decode to
  their empty value when absent rather than failing. The version number
  is not bumped for this: bumping it would declare the older files
  invalid, which is the opposite of what they are. A field whose *value*
  is present and malformed is a different situation and keeps failing
  loudly. This is the read half of #413's snapshot upgrade-path
  obligation.

  This **supersedes #437's absence guard deliberately**, and the
  supersession is the point rather than a casualty: #437 made a missing
  `distinct` key fail loudly so a hand-edited snapshot could not
  silently lose its `distinct`. Hand-edit detection is a real
  requirement, but the decoder is the wrong layer for it — `hejbro
  verify`'s banner hash chain already catches an edited snapshot as
  `snapshot-stale`/`chain-tip-mismatch`, which is the layer that can
  tell "edited" from "written by an older version" at all. The decoder
  cannot: to it, both look like an absent key. What the decoder owns is
  shape drift *within* a version, and for that, absence is history and
  malformation is corruption. The guard's loud failure on a
  present-but-malformed `distinct` stays exactly as #437 wrote it.
- **`min`/`max` keep their argument's read type but not its
  ColumnRef-ness** (F9), so an aggregate stops type-checking where a
  declaration API requires a real column reference.

## Capabilities

### Modified Capabilities

- `query-type-inference`: the write-acceptance rule for `json`/`jsonb`
  gains the null sentence (F4).

Every other finding restores behavior the existing specs already require
(query-builder's injection-safety and scope rules, snapshot-format's
round-trip rule, D67's no-leftover-diff invariant), so they carry no
spec delta — the plain cycle applies to them.

## Impact

- **Affected code**: `packages/core` (`expr/select-children.ts` new,
  `expr/walk.ts`, `expr/render-sql.ts`, `expr/retarget.ts`,
  `expr/codec.ts`, `expr/aggregate.ts`, `query/column-value.ts`,
  `query/select.ts`, `index.ts`), `packages/query`
  (`compile/params.ts`), `packages/supabase`
  (`validators/rls-uncached-auth-call.ts`), `skills/hejbro`.
- **Breaking**: `min`/`max` no longer satisfy an API that demands a
  `ColumnRef` (F9) — code that compiled and then failed at apply time now
  fails to compile, which is the fix. Writing `null` to a `json`/`jsonb`
  column now stores SQL NULL rather than `'null'` (F4); that behavior
  shipped in `write-json-and-bytea` and has not been released, so no
  released contract moves. Both packages are pre-1.0 and the changeset is
  `patch`.
- **Node shape**: unchanged. No golden or example regeneration.
- **Known consequence of F1**, found by the live witness: a *literal*
  used in both `distinct on` and the leading `order by` term now lifts
  to two different `$n` parameters, and Postgres rejects that with
  "DISTINCT ON expressions must match initial ORDER BY expressions" —
  where the old, spec-violating inline text happened to match itself.
  Column references (the normal shape) are unaffected: they are never
  lifted. Deduplicating identical literals into one `$n` would fix it
  and is deliberately not done here — sequential numbering with no
  deduplication is the owner-settled compiler contract (2026-08-26), so
  changing it is a separate decision, not a side effect of a bug fix.
- **Decision log**: no new row.

## Verification note

Two of these are only really proven against a live server, so both get a
witness in `packages/pg/test/integration.test.ts` rather than a
compiler-only assertion: F1 executes a `having`/`distinct on` query whose
value arrives as a bind parameter (a text-spliced value would still
*run*, so the SQL-text assertion alone cannot show the fix is real — the
witness pairs it with an adversarial value that is invalid SQL text), and
F4 writes `null` to a `jsonb` column and shows `where payload is null`
finds the row.
