# Tasks: add-unmanaged-objects (#605)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint and sequential (G2 needs G1's marker, G3 needs
G2's export field).

## 1. The snapshot knows an unmanaged table (#605)
Files: `packages/core/src/kinds/{table-snapshot,table-kind}.ts`,
`packages/core/src/engine/generate.ts`, `packages/core/src/dsl/
existing-table.ts` (doc only), `packages/core/test/**`,
`packages/query/src/client/{synthesize,name-keyed-db}.ts`,
`packages/query/test/client/synthesize.test.ts`,
`packages/supabase/src/validators/reserved-schemas.ts` (comment only).
`synthesize.ts` is shared with group 3 (marker); the groups run
sequentially, so the two never edit it at once.

- [x] 1.1 (~8m) [design — settled, lead judgement J1/J2] The marker is
      `unmanaged?: true` on the table snapshot node (D33 compact rule:
      absent = managed), read through a `tableUnmanaged()` helper beside
      `tableChecks`/`tablePrimaryKeyName`, written by a
      `unmanagedField(declaration)` spread beside `checksField`/
      `primaryKeyNameField` and set from `TableDeclaration.existing`.
      Indexes/checks/rls need no rule: `existingTable()` fixes them
      empty by construction, so the existing serializer already produces
      the right node and `requiredKeys` stays satisfied. Column-level
      facts are kept as serialized today — the export and the contract
      read them for typing and relations, and a second serializer path
      would be a divergence to maintain. Failing test:
      `existing-table.test.ts` — "records an existing table as unmanaged
      with its declared columns".
- [ ] 1.2 (~9m) `generate` accepts an exported `existingTable()`, emits
      nothing for it, and diffs nothing: adding, changing, removing →
      zero statements. The refusal retires at a single chokepoint — the
      guard sits at the top of `tableKind.diff`, before
      `createOrDropDiff`, and returns `[]` when *either* side is
      unmanaged, so a managed↔unmanaged flip emits nothing either (J2).
      The `existing-table-declared` code stays registered with a note.
      Same task, same commit (a task that removes a guard installs its
      replacement): `synthesize.ts` moves its discriminator from
      `existing` to `authority: "usage"`, so `synced-table-declared`
      keeps refusing a vendored contract's table, its own test expecting
      that code instead; `name-keyed-db.ts`'s four `DeclaredTable`
      annotations widen with it. `reserved-schemas.ts`'s comment cites
      the retired refusal and is corrected here.
      Failing tests: `generate.test.ts` — "an unmanaged table produces
      no migration", "changing an unmanaged declaration produces no
      migration", "a managed foreign key onto an unmanaged table is
      emitted and the target untouched", "a managed table replaced by an
      unmanaged one is not dropped"; `synthesize.test.ts` — the refusal
      case, now `synced-table-declared`.
- [ ] 1.3 (~5m) Older snapshots read as all-managed (parse test with a
      pre-marker fixture); the D33 compact rule stated in the node's doc.

## 2. The export and the check (#605)
Files: `packages/cli/src/loader.ts`, `packages/cli/src/export/
description.ts`, `packages/cli/src/check/compare.ts`, `packages/cli/src/
check/inventory.ts`, `packages/cli/src/commands/{reset,raise}.ts` (skip),
`packages/cli/test/**`

- [ ] 2.1 (~8m) [design] The export fact gains `unmanaged: true` on the
      table entry (field name settled here; additive, same format
      version). Failing tests: `export-write.test.ts` — "carries an
      unmanaged table marked as such"; determinism test extended.
- [ ] 2.2 (~9m) `check` compares nothing about an unmanaged table and
      omits it from the inventory. Includes the loader's own
      characterization (planning error corrected: `loader.ts` collects
      every `isTable()` export already, so an exported `existingTable()`
      needs no loader change once group 1 lands — and `loader.ts`'s
      vendored-contract refusal, R2-G5 5.12, keys on the module's
      `contractMetadata`, not on `existing`, so it stays exactly as it
      is). Failing tests: `loader.test.ts` — "an exported existing table
      is loaded as a declaration"; `check-command.test.ts` — "an
      unmanaged declaration is neither compared nor inventoried".
- [ ] 2.3 (~5m) `reset` drops nothing of an unmanaged table and `raise`
      ignores it. Failing test: `reset-command.test.ts` — "reset drops no
      unmanaged table".

## 3. The contract, the client, and the witness (#605)
Files: `packages/cli/src/contract/{tables,emit}.ts`, `packages/query/src/
client/{synthesize,name-keyed-db,contract-types}.ts`, `packages/
supabase/src/auth-tables.ts` (doc), `examples/*/test/*vendor*.test.ts`,
`skills/hejbro/references/{brownfield-adoption,polyrepo}.md` (measure
names), `docs/specs/2026-08-19-hejbro-design.md` (D41 amendment note),
`.changeset/*.md`. `synthesize.ts` is shared with group 1 (see there).

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
- [ ] 3.3 (~7m) Skill sentences (brownfield: an exported `existingTable`
      is now a declaration that emits nothing — the sentence naming the
      hard error goes; polyrepo: unmanaged tables cross the boundary),
      the D41 amendment note beside the decision's own row (the original
      text is never deleted, only annotated: "amended by
      add-unmanaged-objects (#605) — an exported existingTable is a
      declaration that emits nothing; pending owner ratification"),
      `minor` changeset, ledger rows.

## Verification (definition of done, not a task)
`openspec validate add-unmanaged-objects --strict`; `openspec show
add-unmanaged-objects --diff` with zero warnings; `TURBO_FORCE=1 pnpm
check / check-types / test / check:bans / check:crap`; `pnpm build
--force` then the cli subprocess suites and `pnpm --filter hejbro
test:integration` on both majors; the D106 gate before archive.
