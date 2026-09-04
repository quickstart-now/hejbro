# Proposal: harden-core-derivations (#748 + #751 + #774)

## Why

Three places in `@hejbro/core` derive something from a declaration and
let a wrong derivation through silently — no error, and output the
database either refuses later or, worse, accepts with a different
meaning:

- The plpgsql reserved-name list (`packages/core/src/plpgsql/reserved.ts`)
  holds keywords only. It has no entry for the variables plpgsql
  declares on its own — `found` in every function, `sqlstate`/`sqlerrm`
  inside an exception handler, and the `tg_*` variables of a trigger
  function — so `{ args: { found: uuid() } }` compiles into
  `create or replace function "app"."echo_found"(found uuid) … return
  found;`. A keyword in that position fails loudly at `CREATE`; a
  built-in variable does not — the function is created and the user's
  name and plpgsql's own resolve to different things, so `if found`
  reads the wrong one. Found by the harden-function-dsl reviewer, an
  older gap (#748).
- `defineFunction` derives each argument's SQL name from its key and
  checks the name's shape (`invalid-sql-name`) and its reservedness
  (`reserved-local-name`), but never checks the names against each
  other. `{ args: { userId: uuid(), user_id: uuid() } }` renders
  `(user_id uuid, user_id uuid)`, which PostgreSQL 15.19 refuses at
  `CREATE FUNCTION` with `parameter name "user_id" used more than once`.
  A table already refuses two column keys that derive to one column
  name (`duplicate-column`); the argument side promised "derived exactly
  as a column's name is derived" and did not keep it on this axis
  (#751, D106 round-1 review of harden-function-dsl, N1).
- `diffSnapshots`' same-kind dependency refinement
  (`packages/core/src/engine/diff-engine.ts`, `refineByDependsOnIdentities`)
  reassembles a kind's changes through a `Map` keyed by identity. A kind
  whose `diff` reports two changes for one identity in one direction —
  two creates, or two alters — has the first overwritten by the second
  and the second placed twice, since the identity list still carries it
  twice. No built-in kind reports that shape today, but
  `dependsOnIdentities` is part of the public extension interface and a
  preset kind can; the loss is silent (#774, found in the #753 review).

## What Changes

- The reserved-name list gains the names plpgsql declares itself
  (`found`, `sqlstate`, `sqlerrm`, the twelve `tg_*` variables) and the
  SQL keywords Postgres fully reserves that the list was missing; the
  refusal is the existing `reserved-local-name`, applied uniformly to
  every function, and the comparison folds case the way Postgres folds
  an unquoted identifier, so a row or loop name spelled `FOUND` is
  refused too.
- `defineFunction` refuses an `args` object whose keys derive to one
  shared SQL name with `duplicate-argument`, naming the function, both
  keys and the shared name — after each key's own refusals, over the
  whole list, first colliding pair in declaration order, the same
  placement the table's column check has.
- The same-kind refinement carries every change a kind reports exactly
  once: same-identity changes travel as one unit placed by their shared
  identity, in the order the kind reported them. The refinement's own
  ordering rules are unchanged.
- One `patch` changeset; `skills/hejbro` names the new refusal and the
  widened reserved set.

## Capabilities

- `plpgsql-function-bodies` — ADDED: a local name is never one plpgsql
  declares itself.
- `function-declaration` — ADDED: two argument keys never share one SQL
  name.
- `snapshot-diff` — new capability, ADDED: every change a kind reports
  reaches the change list. Its Purpose is written in the same commit
  that creates the capability.

## Impact

- Group 1 (one team, sequential): `packages/core/src/plpgsql/reserved.ts`,
  `packages/core/src/dsl/define-function.ts`,
  `packages/core/src/engine/diff-engine.ts`; tests
  `packages/core/test/define-function.test.ts`,
  `packages/core/test/plpgsql/body-context.test.ts`,
  `packages/core/test/diff-engine.test.ts`;
  `skills/hejbro/references/function-builder-pitfalls.md`;
  `.changeset/harden-core-derivations.md`.
- Core stays pure: no I/O, no runtime dependency. No change to the
  `ObjectKind` interface, to generated SQL for any declaration that
  compiles today, or to any diagnostic code that exists today.
- Refs #748, #751, #774.
