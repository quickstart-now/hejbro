# Tasks: add-unmanaged-objects (#605)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint and sequential (G2 needs G1's marker, G3 needs
G2's export field).

## 1. The snapshot knows an unmanaged table (#605)
Files: `packages/core/src/kinds/table-snapshot.ts`, `packages/core/src/
snapshot/*.ts` (build/parse), `packages/core/src/engine/generate.ts`,
`packages/core/src/dsl/existing-table.ts` (doc only), `packages/core/test/**`

- [ ] 1.1 (~8m) [design] The marker: `unmanaged?: true` on the table
      snapshot node (compact rule: absent = managed), set from
      `TableDeclaration.existing`. Settle whether indexes/checks/rls on
      an existing table are recorded (they cannot be declared today —
      record columns and foreign-key-target identity only). Failing
      test: `snapshot` build test — "records an existing table as
      unmanaged with its declared columns".
- [ ] 1.2 (~9m) `generate` accepts an exported `existingTable()` (the
      `existing-table-declared` refusal is retired — its code stays
      registered with a note, its test flips), emits nothing for it, and
      diffs nothing: adding, changing, removing → zero statements.
      Failing tests: `generate.test.ts` — "an unmanaged table produces
      no migration", "changing an unmanaged declaration produces no
      migration", "a managed foreign key onto an unmanaged table is
      emitted and the target untouched".
- [ ] 1.3 (~5m) Older snapshots read as all-managed (parse test with a
      pre-marker fixture); the D33 compact rule stated in the node's doc.

## 2. The export and the check (#605)
Files: `packages/cli/src/loader.ts`, `packages/cli/src/export/
description.ts`, `packages/cli/src/check/compare.ts`, `packages/cli/src/
check/inventory.ts`, `packages/cli/src/commands/{reset,raise}.ts` (skip),
`packages/cli/test/**`

- [ ] 2.1 (~7m) The loader keeps an exported `existingTable()` as a
      declaration (R2-G5 5.12's refusal is retargeted: it refused what
      generate refused; now neither does). Failing test: `loader.test.ts`
      — "an exported existing table is loaded as a declaration".
- [ ] 2.2 (~8m) [design] The export fact gains `unmanaged: true` on the
      table entry (field name settled here; additive, same format
      version). Failing tests: `export-write.test.ts` — "carries an
      unmanaged table marked as such"; determinism test extended.
- [ ] 2.3 (~8m) `check` compares nothing about it and omits it from the
      inventory; `reset` drops nothing of it; `raise` ignores it. Failing
      tests: `check-command.test.ts` — "an unmanaged declaration is
      neither compared nor inventoried"; `reset-command.test.ts` — "reset
      drops no unmanaged table".

## 3. The contract, the client, and the witness (#605)
Files: `packages/cli/src/contract/{tables,emit}.ts`, `packages/query/src/
client/{synthesize,name-keyed-db,contract-types}.ts`, `packages/
supabase/src/auth-tables.ts` (doc), `examples/*/test/*vendor*.test.ts`,
`skills/hejbro/references/{brownfield-adoption,polyrepo}.md` (measure
names), `.changeset/*.md`

- [ ] 3.1 (~9m) [design] The contract emits the unmanaged table's
      `Row`/`Insert`/`Update` and marks its client metadata; relations
      onto it resolve (the "no relation" rule narrows to undeclared
      tables). Failing tests: contract emit test — "emits an unmanaged
      table under Tables, marked"; relation test — "a foreign key onto a
      declared unmanaged table resolves to a relation".
- [ ] 3.2 (~9m) The two-repository witness: the examples' supabase
      schema exports `authUsers` as unmanaged; the consumer reads a
      managed table joined to it against a real server (PG15/PG17).
      Failing test: the existing witness gains the join.
- [ ] 3.3 (~5m) Skill sentences (brownfield: an exported `existingTable`
      is now a declaration that emits nothing; polyrepo: unmanaged
      tables cross the boundary), `minor` changeset, ledger rows.

## Verification (definition of done, not a task)
`openspec validate add-unmanaged-objects --strict`; `openspec show
add-unmanaged-objects --diff` with zero warnings; `TURBO_FORCE=1 pnpm
check / check-types / test / check:bans / check:crap`; `pnpm build
--force` then the cli subprocess suites and `pnpm --filter hejbro
test:integration` on both majors; the D106 gate before archive.
