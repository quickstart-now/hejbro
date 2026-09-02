# Proposal: curate-hejbro-barrel (#471)

## Why

The `hejbro` package's `export * from "@hejbro/core"` republishes core's
engine to end users. Measured on `dev` (`a45a3a24`): core has 204
runtime exports; 107 are the declaration and query vocabulary a schema
author or query writer types, and 97 are the engine — `render*`,
`decode*`/`encode*`, `diff*`, the kind registry and every `*Kind`, the
banner parsers, the chain walker, the snapshot codec, the traversal
tables (`SELECT_CLAUSE_TRAVERSALS`), brands and helpers three sibling
packages consume. All 204 reach a user's autocomplete through `hejbro`.
Core is not over-exporting: `@hejbro/query`, `hejbro`'s own CLI,
`@hejbro/supabase`, `@hejbro/neon` and `@hejbro/nile` import 55 of those
engine names from `@hejbro/core` today, and that entry is the interface
the presets are built on. The defect is only that the `hejbro` barrel
forwards the whole distribution list unfiltered, and that nothing pins
the barrel's composition — `packages/cli/test/exports.test.ts` asserts
individual names, so every new engine symbol leaks silently.

The owner parked this issue while the polyrepo change was extending the
`hejbro` barrel; that change has landed and archived. Removing released
surface pre-1.0 is a `minor` with a changeset that names what moved and
where to import it from.

## What Changes

- `hejbro` re-exports core's **types** wholesale (`export type *`) and
  its **values** by an explicit list: the declaration vocabulary (schema,
  table, columns and types, enums, functions, triggers, views, grants,
  RLS, indexes, checks), the expression and query vocabulary (`sql`,
  operators, aggregates, window functions, `select`/`insert`/`update`/
  `deleteFrom`/`withCte`), the user-facing utilities (`HejbroError`,
  `assertNoNulls`, `roleName`, the option tables), the three banner
  readers the skill documents as `hejbro` exports, and the one brand a
  shipped spec names as reaching users through `hejbro`
  (`leftJoinedBrand`). Everything else core exports stays importable from
  `@hejbro/core` and stops appearing on `hejbro`.
- The classification is a reasoned pair of lists, not a bare allowlist:
  every runtime export of `@hejbro/core` SHALL appear in exactly one of
  `VOCABULARY` or `ENGINE`, and a core export in neither — a newcomer
  nobody classified — fails `hejbro`'s own test. That is the
  `UNREACHABLE_NODE_KINDS` pattern from `.claude/rules/naming.md`: the
  list is complete by construction or the build is red.
- `hejbro`'s runtime export set is pinned by set equality (the neon
  preset's `entry.test.ts` shape), so the settled surface stays settled
  by machine.
- No change to `@hejbro/core`, `@hejbro/query` or any preset: their
  imports are from `@hejbro/core` already. The examples' own chain tests
  import six engine names from `hejbro` and move to `@hejbro/core`
  (private packages); the skill's snippets import only vocabulary.
- One `minor` changeset: engine names leave `hejbro`; import them from
  `@hejbro/core`.

## Capabilities

### New Capabilities

- `package-surface`: what the `hejbro` package exports and how that
  surface is kept complete and pinned.

### Modified Capabilities

(none)

## Impact

- `packages/cli/src/index.ts`, a new `packages/cli/src/core-surface.ts`
  (the two lists), `packages/cli/test/exports.test.ts`,
  `examples/{postgres,supabase}/test/*.test.ts` (import source only),
  `skills/hejbro/SKILL.md` (one sentence: engine helpers come from
  `@hejbro/core`), `.changeset/*.md`, `openspec/task-times.csv`.
- Type-level surface unchanged (`export type *`). Runtime surface of
  `hejbro` shrinks from 204 + query + cli names to 107 + query + cli.

## Out of scope

- A second core entry (`@hejbro/core/internal`) and moving sibling
  imports: the presets' interface is `@hejbro/core` and stays so; the
  defect is on the `hejbro` barrel only.
- Curating `@hejbro/query`'s re-exports (it exports exactly 3 values
  today — the counter-model, not a problem).
