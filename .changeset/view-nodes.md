---
"@hejbro/core": minor
---

A view's own query is now stored in the snapshot as a **structured
`SelectNode`** (`ViewSnapshot.query`, reusing #110/D67's expression
codec) instead of pre-rendered SQL text (`ViewSnapshot.selectSql`, D27's
original shape). This is what lets a table or column rename retarget the
identifiers inside a view's query exactly, the same way #110 already
does for column defaults, CHECK expressions, partial index `where`
predicates, and policy `using`/`withCheck` clauses.

**This is not a defect fix.** `create or replace view` already resolves
a renamed dependency correctly today (Postgres re-resolves the view body
against current names at replace time, not against the names in the
stored definition text), and a *column* change to a view's own query is
already a single `drop`+`create` pair (D27's prefix rule), never two
independent add/drop halves a rename heuristic could misread. Nothing
here was broken. It's done now anyway because pre-1.0 is the only free
moment to change a snapshot's shape (D65): after publication, doing this
later would mean a real format-version bump plus a migration story
hejbro doesn't have yet, and it changes how an *unchanged* view
declaration renders in the snapshot even though it changes no emitted
SQL — D65's own trigger condition for "must happen before 0.1.0, not
after."

**No format-version bump.** `formatVersion` stays `5` — D68 already
opened this pre-publication wave's single version for exactly this kind
of change ("a change that alters how an unchanged declaration renders"),
and this is the same wave, not a new one. **v5 carries the view field as
well; D68's single pre-publication bump is unchanged.**

Breaking shape change, no compatibility shim, consistent with hejbro's
no-snapshot-compatibility-promise-before-1.0 policy (AGENTS.md/D65) —
but milder than #110's own equivalent note for the other four fields:
confirmed by direct reproduction (a scratch snapshot with a
`selectSql`-shaped view, read by this change's built CLI, not just
reasoned about) that `hejbro generate` does **not** throw. `emit` only
ever reads the *current* declaration's freshly-serialized `query`, never
decodes the *previous* snapshot's view field on a normal (non-`--rename`)
run — the old `selectSql` value is only ever compared as raw JSON
(`sameJson`), never decoded. Since a `selectSql`-shaped node and a
`query`-shaped node are never byte-identical even when nothing about the
declaration changed, every existing view gets exactly one spurious but
harmless `~ view … [view changed]` migration on the first `generate`
after upgrading — re-emitting `create or replace view` with byte-identical
SQL to what already exists, not a crash and not a real change. A `--rename`
run *does* decode the previous view's field (`rewriteExpressionReferences`),
so an old-format snapshot combined with a rename touching a view still
fails with `error[malformed-snapshot-node]`, same as #110's other four
fields.
