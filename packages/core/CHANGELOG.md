# @hejbro/core

## 0.1.0

### Minor Changes

- 2e125e8: Add Changesets-based release tooling: `.changeset/config.json` (a fixed
  version group across the three published packages, public npm access,
  `dev` as the base branch), root `changeset`/`version-packages`/`release`
  scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
  Introducing the release infrastructure itself is not a patch.
- 58dcafa: The Supabase storage bucket kind's `alter` change now reports which
  fields actually changed (`"public changed"`, `"file size limit
  changed"`, `"allowed mime types changed"`) instead of an empty `notes:
  []`. Previously every bucket config change rendered a bare `-- ~
  supabase-storage-bucket <name> []` in the migration banner -- the only
  kind that emitted an empty notes list on an alter (#116).
- fb76507: Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
  `@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
  `test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
  now — no CI gate yet. `package.json` (a `devDependencies` entry and a
  new script) does change in all three published packages; `package.json`
  is always packed regardless of `files`, so D59's changeset rule applies
  literally here, not by analogy to a prior PR's precedent.
- 77120e7: `HejbroError` is now a real `Error` subclass instead of a plain object
  type. `code`, `message`, and `declaredAt` remain accessible the same way,
  but the CLI's `catch`-clause discriminator now checks `instanceof
  HejbroError` instead of duck-typing on "has a `code` and a `message`" —
  the old check misidentified any Node runtime error carrying a `.code`
  (e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125). A plain object
  literal shaped like `{ code, message, declaredAt }` no longer satisfies
  the `HejbroError` type; build `HejbroError`s via the `hejbroError`
  factory instead — this can break consumer code that constructed one by
  hand rather than through the factory, hence `minor`, not `patch`.
- 67b9670: Column defaults, CHECK expressions, partial index `where` predicates,
  and policy `using`/`withCheck` clauses are now stored in the snapshot
  as structured expression nodes (D67/D70) instead of pre-rendered SQL
  text. This is what lets a table or column rename retarget the
  identifiers inside these expressions exactly — including across
  tables, when a policy reaches another table through `exists()` —
  instead of leaving stale text behind. Rendered SQL output is
  unaffected: the same `renderExpr` produces the same text at emit
  time, now from a decoded node instead of a stored string.
  
  **No format-version bump.** `v5` was opened by #152 for this change
  (D68); a snapshot generated in the intermediate `dev` state between
  #152 and #153 is not supported — no published version ever produced
  such a snapshot. A committed snapshot containing any of these four
  fields as pre-rendered SQL text (the only shape any published version
  of `v5`, or any earlier format version, ever wrote) will fail with
  `error[malformed-snapshot-node]` when read by `hejbro generate` —
  confirmed by reading a real snapshot from immediately before this
  change. hejbro makes no snapshot-compatibility promise before 1.0
  (pre-publication, no migration path — see AGENTS.md/D65); this is the
  kind of churn that policy exists to allow while it's still free.
- 84670f9: Every user-facing `HejbroError` now pairs its "why" with a "Next:"
  clause stating a concrete, executable action (spec §7) — 59 call sites
  across `@hejbro/core` and `@hejbro/supabase` gained one, either by
  adding the literal `Next:` marker to guidance that was already there or
  by authoring new guidance. Internal-invariant guards (unreachable by
  any user action, confirmed by direct reproduction for the two
  ambiguous cases) are left as-is. A new `scripts/check-next-marker.mjs`
  (wired into `pnpm check:next-marker` and CI) keeps this a checked
  invariant going forward instead of a one-time sweep.
- 75f2d0a: Snapshot format version bumped to `5` (D68). This PR only moves the
  version marker — no snapshot shape changed yet, so every existing
  declaration renders an identical snapshot object graph, just under
  `formatVersion: 5`. The actual shape changes this version opens the
  door for (structured expression nodes, primary key/unique constraint
  names) land in later PRs of the same wave without needing their own
  version bump. A snapshot written by a prior build (`formatVersion`
  4 or older) is rejected with the existing `unsupported-snapshot-version`
  diagnostic, same as any other format bump.
- 50ac657: `Table`'s and a trigger's `new`/`old` row's hidden metadata keys
  (`tableMeta`, `triggerRowMeta`) now use `Symbol.for` instead of
  `Symbol()`. Two installed copies of `@hejbro/core` (a real, if rare,
  package-manager outcome — e.g. a version-conflict-driven nested
  install) used to mint two different symbols sharing the same
  description, so `isTable`/`getTableMeta` — and, downstream, a foreign
  key's `references.table` cross-check (the shape `@hejbro/supabase`'s
  `authUsers` is used in) — could silently disagree about a table's
  identity across that boundary, up to and including a raw `TypeError`
  instead of a diagnostic. `Symbol.for`'s global registry makes the
  identity survive being installed twice.
- 92f075b: A view's own query is now stored in the snapshot as a **structured
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
