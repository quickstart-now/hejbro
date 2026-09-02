# Tasks: emit-typed-functions (#587)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint; G2 needs G1's export field names and G3 needs
G2's metadata shape — settle both in G1/G2's `[design]` tasks and record
them here before the next group opens.

## 1. The facts the export must carry (#587)
Files: `packages/core/src/dsl/define-function.ts`, `packages/core/test/
define-function.test.ts`, `packages/core/test/plpgsql/body-context.test.ts`,
`packages/cli/src/export/description.ts`, `packages/cli/src/export/
format.ts` (its bump rule, comment only), `packages/cli/src/vendor/
validate-export.ts` (the read side — it is under `vendor/`, not
`export/`), `packages/cli/test/export-*.test.ts`, the vendor
export-validation test, this change's own `specs/schema-export/spec.md`

- [x] 1.1 (~6m) The resolved argument list keeps `key` beside `argName`
      at runtime (additive; the brand's type-level `TArgs` is untouched).
      Failing test: `packages/core/test/define-function.test.ts` — "keeps
      each argument's declared key beside its SQL name", declared with a
      key that differs from its SQL name, so an implementation that sets
      `key` from `argName` stays red. Two existing fixtures assert the
      argument entry by value and move with the field
      (`define-function.test.ts`, `plpgsql/body-context.test.ts`).
- [x] 1.2 (~9m) [design — settled by the lead, 2026-09-02]
      `ExportFunctionFact` gains `args: ReadonlyArray<{ key: string;
      sqlName: string }>` in declaration order and `returns: { kind:
      "scalar" } | { kind: "table"; schemaName: string; tableName: string
      } | null`. A table return carries the SQL identity, never the
      returned table's export name — that fact already rides in
      `tables[]`, and the contract emitter joins on schema and name,
      dropping an entry whose table the export does not carry (the rule
      `computeTables` already applies to a fact with no snapshot node).
      `null` is what a trigger-synthesized function's return reads as: it
      is neither scalar nor table, and the delta's prose says so in the
      same task. Additive; `manifest`/description format version
      unchanged; a reader of an older export sees the fields absent. The
      file's own doc comment, which states that a function argument's
      TypeScript key cannot be added without a DSL change, is false as of
      1.1 and is rewritten here. Failing tests: `export-facts.test.ts` —
      "carries a function's argument keys and return shape", "a
      trigger-synthesized function's fact carries no return shape" (the
      observer the delta's own scenario now names); that file's existing
      assertions that a function fact has no such properties are the
      same claim inverted and move with them. `export-write.test.ts`
      gains one round trip through the built CLI, so the facts are
      proved where they are actually written rather than only where they
      are built; `export-determinism.test.ts` extended (byte-identical
      across two runs with a function declared).
- [x] 1.3 (~6m) The read side admits the new facts. `vendor/
      validate-export.ts`'s `functionFactSchema` is a zod object, which
      **drops keys it does not name**: an export carrying the new facts
      would validate and arrive at the contract emitter with them
      silently removed, so group 2 would receive nothing and every gate
      here would stay green. Extend the schema, and pin it with a test
      that reads a description through `validateExport` and asserts the
      argument keys and return shape survive it. Two comments beside it
      state the shape's history by counting fields and by a bump rule
      this change deliberately does not follow (the proposal keeps the
      description format at its current version, since a reader refuses
      a *newer* format wholesale and would refuse an export it could
      read past); both move with the fields. A return shape the schema
      fails to name is not dropped but **refused**, so a legitimate
      export would be rejected as hand-edited — all three shapes
      (scalar, table, `null`) are fixtures, not one. Failing test: the
      vendor export-validation test — "keeps a function's carried
      facts".

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
      synthesized function is absent". **Carried in from group 1**:
      `emit.ts`'s `EMPTY_SECTION` comment says the export carries no
      function signatures, which group 1 made false — this group's own
      edit is what corrects it, and it is a false statement in the tree
      until then, not a docs nit.
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
