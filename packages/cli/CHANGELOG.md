# hejbro

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
- 99b853c: `hejbro generate` now accepts `--flag=value` as well as `--flag value`
  for every value-taking flag (`--config`, `--name`, `--rename`,
  `--confirm-drop`). The equals form used to be silently dropped —
  for `--rename`/`--confirm-drop` specifically, that meant an unresolved
  rename ambiguity fell back to a destructive drop+create instead of a
  rename. The suggested rerun command printed on an ambiguity diagnostic
  was corrupted by the same bug — it echoed the unparsed `--flag=value`
  token and appended a duplicate — and is now correct for either form.
- 50f0e85: `hejbro generate`/`hejbro verify` no longer crash with a raw, uncaught
  Node error when `hejbro.config.ts` or a declaration file imports a
  package that fails to resolve (not installed, or installed with an
  `exports` field that doesn't resolve) — this now renders as a proper §7
  diagnostic (`config-load-failed`/`declaration-load-failed`) naming the
  failing file and the underlying reason, instead of the uncaught stack
  trace #125 reported. A declaration file's own DSL validation errors
  (e.g. an invalid identifier) are unaffected and keep rendering with
  their own code and location, exactly as before.

### Patch Changes

- Updated dependencies [2e125e8]
- Updated dependencies [77120e7]
- Updated dependencies [84670f9]
- Updated dependencies [75f2d0a]
- Updated dependencies [50ac657]
  - @hejbro/core@0.1.0
