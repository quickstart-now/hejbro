# Tasks: emit-typed-functions (#587)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint; G2 needs G1's export field names and G3 needs
G2's metadata shape — settle both in G1/G2's `[design]` tasks and record
them here before the next group opens.

## 1. The facts the export must carry (#587)
Files: `packages/core/src/dsl/define-function.ts`, `packages/core/test/
dsl/define-function.test.ts`, `packages/cli/src/export/description.ts`,
`packages/cli/src/export/*.ts` (read side), `packages/cli/test/export-*.test.ts`

- [ ] 1.1 (~6m) The resolved argument list keeps `key` beside `argName`
      at runtime (additive; the brand's type-level `TArgs` is untouched).
      Failing test: `define-function.test.ts` — "keeps each argument's
      declared key beside its SQL name".
- [ ] 1.2 (~9m) [design] `ExportFunctionFact` gains `args: [{ key, sqlName
      }]` in declaration order and `returns: "scalar" | "table"` (settle
      the exact field names and whether a table return carries the
      table's schema/name — it must, for the consumer to type the rows).
      Additive; `manifest`/description format version unchanged; a reader
      of an older export sees the fields absent. Failing tests:
      `export-write.test.ts` — "carries a function's argument keys and
      return shape"; `export-determinism.test.ts` extended (byte-identical
      across two runs with a function declared).

## 2. The contract's Functions section (#587)
Files: `packages/cli/src/contract/functions.ts` (new), `packages/cli/src/
contract/emit.ts`, `packages/cli/src/contract/ts-type.ts` (reuse),
`packages/cli/test/contract-*.test.ts`

- [ ] 2.1 (~9m) [design] `Functions` entries: `<exportName>: { Args: {
      key: TsType }; Returns: TsType | Database["Tables"][t]["Row"][] }`
      and the runtime metadata entry (schema, SQL name, ordered args with
      sqlName/typeNode/mode, return kind + table identity). Failing test:
      `contract-emit.test.ts` (or the existing contract test file) —
      "emits a Functions entry per exported function", "a trigger-
      synthesized function is absent".
- [ ] 2.2 (~7m) Determinism and the golden: the generated contract for
      the examples' schema gains its function entries; `contract-
      authority.test.ts` / determinism tests stay green. Failing test: the
      golden diff itself (regenerate deliberately, review the diff).

## 3. The client's fn and the witness (#587)
Files: `packages/query/src/client/name-keyed-db.ts`, `packages/query/src/
db/fn.ts` (reuse of the call plan; export what `fn` needs),
`packages/query/test/client/*.test.ts`, `examples/*/test/*vendor*.test.ts`
(the two-repository witness), `skills/hejbro/references/{query-layer,
polyrepo}.md` (measure the file name), `.changeset/*.md`

- [ ] 3.1 (~9m) [design] `createNameKeyedDb` gains `fn`, keyed by export
      name, typed from `Database["Functions"]`, rendering through the
      same scalar-call / returns-table plan `db.fn` uses (no second
      renderer). Failing tests: `name-keyed-db.test.ts` — "fn renders the
      same SQL as db.fn for a scalar call", "…for a table return, with an
      explicit column list", type test "a mismatched argument fails".
- [ ] 3.2 (~9m) The live witness: vendor the examples' schema into the
      consumer fixture and call one scalar and one table-returning
      function against PG15 and PG17. Failing test: the existing
      two-repository witness gains the two calls (red before G2/G3 land:
      no `fn`).
- [ ] 3.3 (~5m) Skill sentences (the contract now carries functions; call
      them through `fn`), `minor` changeset, ledger rows.

## Verification (definition of done, not a task)
`openspec validate emit-typed-functions --strict`; `openspec show
emit-typed-functions --diff` with zero "No matching main requirement"
warnings; `TURBO_FORCE=1 pnpm check / check-types / test / check:bans /
check:crap`; `pnpm build --force` then `pnpm --filter hejbro
test:integration` on both majors with zero skipped; the D106 gate before
archive.
