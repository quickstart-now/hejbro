# @hejbro/core

## 0.1.0

### Minor Changes

- 2e125e8: Add Changesets-based release tooling: `.changeset/config.json` (a fixed
  version group across the three published packages, public npm access,
  `dev` as the base branch), root `changeset`/`version-packages`/`release`
  scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
  Introducing the release infrastructure itself is not a patch.
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
