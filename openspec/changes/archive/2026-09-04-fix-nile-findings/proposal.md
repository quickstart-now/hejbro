# Proposal: fix-nile-findings (#754, #755)

## Why

Two findings from the first external use of 0.2.0-pre.0 on Nile (#750):

- Every column reference inside a table's own CHECK constraint, partial-index
  predicate, index expression, generated column and policy renders
  schema-qualified (`"lab"."projects"."name"`). A tenant-aware table on Nile
  lives under an internal `<database-id>_<schema>` name, and the platform's
  12-byte schema-name limit is applied to that, so the migration hejbro
  generates fails at apply time (`42622`), and a partial-index predicate fails
  as `missing FROM-clause entry`. The qualification adds nothing at those
  sites — the table an expression belongs to is fixed by the statement it
  sits in — and the shared renderer has no other mode (#754).
- `hejbro check` compares a check constraint by asking the server to render
  both the declared and the catalog expression through one `EXPLAIN`. Nile has
  no `EXPLAIN` at all, so every check constraint is reported as not compared
  with a `Next:` line telling the user to confirm a privilege the server cannot
  grant. Nothing in the preset interface lets a platform say so, and `check`
  connects through the vanilla driver, so a driver-level declaration would
  never reach it (#755).

## What Changes

- At a table-bound site — a check constraint, an index predicate, an index
  expression, a generated column's expression, a policy's `using`/`with
  check` — a column reference renders as `"table"."column"`. A subquery's
  `from`/`join` targets stay schema-qualified; a reference whose bare table
  name is also the bare name of a differently-schemaed row source in scope
  stays schema-qualified too. Views, functions and the query builder are
  untouched. The snapshot format is unchanged (expressions are structured
  nodes); the example migration chains are regenerated because their chain
  tests compare text.
- A preset can declare, as data, that its platform cannot plan a statement
  (`explainUnavailable: true`); silence means it can. The Nile preset declares
  it. When a registered preset declares it, `check` compares a check
  constraint's declared text with the catalog's own text after a fixed
  normalization: equal texts agree; texts that still differ are reported as
  **not compared**, with both texts and a `Next:` that names a restatement,
  never as differing. The coverage boundary states that the run compared by
  text. On every other platform, `check` is unchanged.
- One `patch` changeset; `skills/hejbro` gains one sentence on table-bound
  column references and one paragraph on `check` under Nile.

## Capabilities

- `table-declaration` — MODIFIED: the non-null-elements check's example
  rendering follows the new form; ADDED: a table-bound expression names
  columns by table and column.
- `cli-commands` — MODIFIED: the server-rendering comparison gains its one
  platform-declared exception; ADDED: a preset declares whether its platform
  can plan a statement.

## Impact

- `packages/core/src/expr/render-sql.ts` (table-bound rendering entry and the
  column-reference arm), `packages/core/src/kinds/table-snapshot.ts`
  (accessors), `packages/core/src/kinds/policy-kind.ts`,
  `packages/core/src/snapshot/column-order.ts`, `packages/core/src/index.ts`;
  tests under `packages/core/test/`, `packages/supabase/test/`,
  `packages/nile/test/`, `packages/neon/test/`; `examples/*/migrations/*.sql`.
- `packages/core/src/engine/preset.ts` (`explainUnavailable`),
  `packages/nile/src/preset.ts`, `packages/cli/src/check/expression.ts`
  (text comparison), `packages/cli/src/commands/check.ts` (mode selection and
  boundary line), `packages/cli/src/check/compare.ts` (mode threading); tests
  `packages/cli/test/check-expression.test.ts`,
  `packages/cli/test/check-command.test.ts`, `packages/nile/test/preset.test.ts`.
- `skills/hejbro/references/dsl-cheatsheet.md`,
  `skills/hejbro/references/nile-preset.md`,
  `skills/hejbro/references/brownfield-adoption.md`;
  `.changeset/fix-nile-findings.md` (`patch`).
