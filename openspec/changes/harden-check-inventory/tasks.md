# Tasks: harden-check-inventory

Tracking issues: #707, #726 (the bug issues themselves; one change, one
PR). One group, one team, tasks in order — 1.1–1.4 all edit
`packages/cli/src/check/inventory.ts`, so they are one slice by
construction. The group's reviewer runs in constructor mode: the input
(a live database's catalog) is foreign to hejbro's own output (D110).

Definition of done for every task: `pnpm check`, `pnpm check-types`,
`pnpm check:bans`, `pnpm test` green (`TURBO_FORCE=1` in this worktree;
`pnpm build --force` first when a subprocess or Docker suite runs); the
delta scenarios of `openspec show harden-check-inventory --diff` hold.

## 1. `check`'s inventory names database-only objects on managed tables (#707 · #726)

- [ ] 1.1 [design] ~8m — Red: `packages/cli/test/check-inventory.test.ts`
  new describe "the inventory's anchor is a managed table" with an input
  table over the four table states × one database-only column each —
  a table a `table:` declaration manages (listed), a catalog table no
  declaration covers (not listed as a column; the table's own unmanaged
  line stands), a table declared `existingTable()` (nothing listed), a
  table in a schema no declaration touches (nothing listed) — asserted
  through `buildInventory`. Green: the managed-table identity set in
  `inventory.ts` (declared, non-`existing`, schema-scoped, reusing
  `declaredSchemaNames`/`declaredTableIdentities`), `Inventory` gaining
  its object-level arrays, and `EMPTY_INVENTORY` (`commands/check.ts`)
  updated to match.
  Files: `packages/cli/src/check/inventory.ts`,
  `packages/cli/src/commands/check.ts`, the test.
- [ ] 1.2 ~8m — Red: same file, describe "unmanaged columns" with an
  input table over column kinds on one managed table: a column the
  declaration covers (never listed), a database-only plain column, a
  database-only generated column, a database-only identity column, a
  column whose name no declaration could carry (`_id`, `"createdAt"`) —
  the last four all listed by `schema.table.name`, none of them read for
  type, default or expression. Green: the column axis in `inventory.ts`.
  Files: `packages/cli/src/check/inventory.ts`, the test.
- [ ] 1.3 [design] ~9m — Red: same file, describe "unmanaged indexes"
  with an input table over `pg_index` rows on one managed table: an index
  the declaration names (not listed), an index named after the declared
  primary key (not listed), an index named after a declared column's
  unique constraint (not listed), a database-only plain index, a
  database-only partial index, a database-only expression index, an index
  backing a database-only primary key and one backing a database-only
  unique constraint (all four listed, once each). Green: the index axis
  and its declared-constraint-name exclusion in `inventory.ts`.
  Files: `packages/cli/src/check/inventory.ts`, the test.
- [ ] 1.4 ~7m — Red: same file, describe "unmanaged check constraints"
  with an input table over `pg_constraint` rows on one managed table: a
  check the declaration names (not listed), a database-only check, and
  one row of each other constraint type (`p`, `u`, `f`) on the same table
  (never listed as a check constraint). Green: the check axis in
  `inventory.ts`.
  Files: `packages/cli/src/check/inventory.ts`, the test.
- [ ] 1.5 [design] ~9m — Red: `packages/cli/test/check-command.test.ts`
  new describe "the inventory section names objects, not only tables"
  with an input table over the three kinds × several identities supplied
  in scrambled catalog order: each prints one
  `unmanaged <kind> (not covered by any declaration): <identity>` line,
  the lines come out in identity order regardless of input order, none
  carries an error code or a `Next:` line, and a run whose only report
  content is inventory exits zero. Green: `inventoryLines` in
  `commands/check.ts`.
  Files: `packages/cli/src/commands/check.ts`, the test.
- [ ] 1.6 ~7m — Red: `packages/cli/test/infer-loss-report.test.ts` new
  cases over the omitted-index and omitted-check lines: each states that
  `check` keeps listing the object as unmanaged until it is renamed in
  the database, and neither contains "will not mention it again"; the
  omitted-column and omitted-table lines keep saying what they say today
  (regression, asserted against the current strings). Green: the two
  consequence sentences in `infer/loss-report.ts`.
  Files: `packages/cli/src/infer/loss-report.ts`, the test.
- [ ] 1.7 ~9m — Red:
  `packages/cli/test/check-live.integration.test.ts` new case against
  `postgres:17-alpine`: hejbro's own migration applied, then a
  database-only column, index and check constraint added on the managed
  table and a second index created for a database-only unique constraint
  — `check` prints one inventory line for each, prints none for the
  indexes backing the declared primary key and unique column, and exits
  zero. Green: whatever the fake-catalog tests above left unproven
  against a real catalog. Same task: `skills/hejbro`'s check section
  states what the inventory covers, and
  `pnpm check:next-marker` / `pnpm check:diagnostic-xref` are re-run
  (the inventory carries no code, so neither reference gains an entry —
  confirm rather than assume).
  Files: `packages/cli/test/check-live.integration.test.ts`,
  `skills/hejbro/references/brownfield-adoption.md`.
- [ ] 1.8 ~8m — Red: `examples/brownfield/test/brownfield.integration.test.ts`
  — the corpus witness that today stops at
  `// the column line's own check promise is not asserted -- #726`
  asserts it instead: after the corpus `import`, `check` still exits 0
  with `check: no differences.` and no `error[` line, still names
  `shop.Widgets` and still never names `Marketing`, and now also names
  each column the loss report said it would (`catalog.products."a*/b"`,
  `people.accounts._id`) — while naming no object *inside*
  `shop.Widgets`, the unmanaged table. Green: nothing new in `src` if
  1.1–1.5 are right; a corpus-level disagreement is a finding to report,
  not to patch here.
  Files: `examples/brownfield/test/brownfield.integration.test.ts`.
