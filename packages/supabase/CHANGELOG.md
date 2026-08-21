# @hejbro/supabase

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
- 84670f9: Every user-facing `HejbroError` now pairs its "why" with a "Next:"
  clause stating a concrete, executable action (spec §7) — 59 call sites
  across `@hejbro/core` and `@hejbro/supabase` gained one, either by
  adding the literal `Next:` marker to guidance that was already there or
  by authoring new guidance. Internal-invariant guards (unreachable by
  any user action, confirmed by direct reproduction for the two
  ambiguous cases) are left as-is. A new `scripts/check-next-marker.mjs`
  (wired into `pnpm check:next-marker` and CI) keeps this a checked
  invariant going forward instead of a one-time sweep.

### Patch Changes

- Updated dependencies [2e125e8]
- Updated dependencies [58dcafa]
- Updated dependencies [fb76507]
- Updated dependencies [77120e7]
- Updated dependencies [67b9670]
- Updated dependencies [84670f9]
- Updated dependencies [75f2d0a]
- Updated dependencies [50ac657]
- Updated dependencies [92f075b]
  - @hejbro/core@0.1.0
