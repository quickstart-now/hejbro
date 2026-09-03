# Proposal: add-catalog-inference (#604)

## Why

Two situations need hejbro to read a live catalog instead of
declarations, and the polyrepo change stated both honestly before
deferring them here. A repository adopting hejbro over an existing
database has to write step one — the declarations — by hand; the
brownfield guide says so in as many words ("introspection-assisted
seeding … does not exist"). And a consumer that must connect before the
schema repository uses hejbro at all has no export to vendor. Both are
the same reading of the same catalog, feeding two different emitters:
the declaration source a repository will own from then on (`import`),
and the contract a consumer reads (`pull --db-url`, the marked fallback
to the git channel). A catalog cannot supply three things the
declarations decide — each column's TypeScript key, each function's
argument names, and the value-conversion policy — so both entry points
SHALL announce what they guessed and what to do once the other side is
linked. Neither is a second channel; the polyrepo change's own sentence
stands: the database path never licenses reading a catalog anywhere
else.

## What Changes

- **Catalog-to-IR inference**, built once: the read-only catalog queries
  `check` already runs (`CHECK_CATALOG_QUERIES`) are read into a snapshot
  — schemas, tables with columns, defaults, identity/generated markers,
  primary keys, foreign keys, checks, indexes, enum types, and the
  sequences an identity or serial column owns — and
  an export description whose declaration-time facts are **guessed and
  marked as guessed**: TypeScript keys by a stated rule (snake_case →
  camelCase, collisions resolved by a stated rule), numeric mode the
  default, element nullability unknown → nullable, no function export
  names or argument keys (functions are not inferred in v1), roles from
  the grants present. What v1 does not infer is listed as
  such: functions, triggers, policies' expressions, views' bodies,
  grants beyond role names.
- **`hejbro import`** (`--url`/`DATABASE_URL`, the `check` rule): writes
  starter declaration files from the inferred snapshot — one file per
  schema, `table()` per table with the declared-looking column builders
  hejbro can map, `pgEnum` per enum — into a directory the command names
  and never overwrites, and prints the loss report. A starter, not a
  round trip: `hejbro baseline` then produces the migration that would
  create what the database already has, marked in its banner so that
  `migrate` registers it rather than runs it.
- **`hejbro pull --db-url`**: the inferred payload fed to the same
  contract emitter the git channel uses; the contract carries an origin
  that names the database (no commit, no export hash) and a header line
  saying it was inferred; `vendor --check`/`outdated` refuse a
  database-sourced lock with a coded diagnostic naming `link` as the
  way forward.
- Diagnostics: each way the database path can fail is its own code
  (no connection source, cannot connect, catalog unreadable, nothing to
  infer in the named schemas, destination not writable).
- One `minor` changeset.

## Capabilities

### New Capabilities

- `catalog-inference`: what a catalog reading yields, what it guesses,
  what it does not infer, and how the loss is announced.

### Modified Capabilities

- `cli-commands` — ADDED requirements for `import` and `pull --db-url`
  (connection sourcing shared with `check`; starter files; never
  overwrite).
- `schema-vendoring` — ADDED "A database-sourced contract is marked and
  refused by the checks that need a commit".
- `table-declaration` — ADDED "A foreign key can carry the name the
  database already gave it" (D106 round 3).

## Impact

- `packages/cli/src/infer/` (new: catalog → snapshot + description),
  `packages/cli/src/commands/{import,pull}.ts` (new), `main.ts`
  registration, `contract/emit.ts` (origin variant), `vendor/state.ts`
  (database-sourced lock refusal), `check/catalog.ts` (reused as-is for
  the shared inventory; the facts inference needs on top of it are read
  by its own read-only queries under `infer/`),
  `packages/cli/src/declare-emit/` (new: inference output → DSL source
  — the snapshot alone carries no declaration keys),
  each new command's own code literals at their raise sites (there is
  no diagnostics registry — `check:diagnostic-xref` checks docs
  citations against those literals, one way), tests,
  a live witness (import an examples
  database, generate against empty, diff against the examples' own
  migration), `skills/hejbro/references/brownfield-adoption.md` and the
  polyrepo reference, `.changeset/*.md`, `openspec/task-times.csv`.
- `@hejbro/core`: a foreign key's optional `name` (D106 round 3) — the
  slot an index and a check already had; inference and emission
  otherwise live in the CLI, and the snapshot codec is reused as-is.

## Out of scope

- The lossless variant (storing the real IR beside the ledger) and
  drift detection from it.
- Inferring functions, triggers, policies, views, grants (v1 lists them
  as not inferred).
- Making the database path primary or removing the warning.
