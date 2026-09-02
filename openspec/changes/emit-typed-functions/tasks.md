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
      returned table's export name — and the SQL identity is what the
      emitter actually needs: `Database["Tables"]` is keyed by the bare
      SQL table name (`renderTableEntry`), so a return type names that
      key directly and no join to an export name happens at all. A
      function whose returned table the contract does not emit is
      dropped rather than guessed at, the rule `computeTables` already
      applies to a fact with no snapshot node.
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

- [x] 1.4 (~12m) The carried facts are enough to type a call. Found
      while designing group 2, from both sides at once: the snapshot
      renders a function argument's type as **SQL text**
      (`function-kind.ts`, `renders type: renderTypeNode(...)`), while a
      table column keeps a structured `typeNode` — so nothing in the
      contract's reach can map an argument to a TypeScript type, and no
      reverse parser exists anywhere in `packages/` (searched by name,
      zero hits). Worse, core's own `resolveArgs` **drops** the
      builder's `mode` and `notNullElements`, so the choice is not even
      in the live declaration to be carried. The measure of what must be
      carried is the owning repository's own type: `db.fn`'s arguments
      are `FnArgsInput = { [K]: ColumnTsType<TArgs[K]> }`, a column's
      read type, which honours numeric mode and element nullability — a
      consumer types the same call only with the same facts. A scalar
      return needs `typeNode` and `mode` only, since core rejects
      `.notNullElements()` on a return, so an array return is typed with
      nullable elements. Path: core keeps them on the resolved argument
      → `description.ts` carries them → `validate-export.ts` admits them
      → tests. Failing tests, one per layer: `define-function.test.ts` —
      "keeps an argument's declared mode and element nullability";
      `export-facts.test.ts` — "carries an argument's declared type and
      choices"; the vendor export-validation test — the union's new
      members, including which omissions read as *dropped* and which as
      *refused* (1.3's own two directions).

## 2. The contract's Functions section (#587)
Files: `packages/cli/src/contract/functions.ts` (new), `packages/cli/src/
contract/emit.ts`, `packages/cli/src/contract/ts-type.ts` (reuse),
`packages/cli/test/contract-*.test.ts`

- [x] 2.1 (~9m) [design — settled by the lead, 2026-09-02] `Functions`
      entries: `<exportName>: { Args: { <declared key>: TsType };
      Returns: TsType | ReadonlyArray<Database["Tables"][<sql name>]
      ["Row"]> }`, and a runtime metadata entry that is a **direct
      transcription of the carried facts** — `{ schema, name, args: [{
      key, sqlName, typeNode, mode, notNullElements }], returns }` — so
      the emitter computes only the TypeScript type text and nothing
      else can drift. The argument entries keep `key` because the client
      maps a named-argument object to positional order, and re-deriving
      that mapping by re-casing the key is the one-way conversion this
      whole change exists to escape. Four settled details: an argument
      list of no arguments is `Record<string, never>` (a bare `{}`
      accepts extra properties, so the "an extra argument fails to
      compile" scenario would be quietly false for exactly the functions
      that take none); an empty section is `{}` while `Views` keeps its
      "not carried by this version" marker, because the two now mean
      different things; neither an argument nor a scalar return takes
      `| null`, since the declaring repository's own `db.fn` types do
      not and parity is the point; an array return's elements are
      nullable. Failing test:
      `contract-emit.test.ts` (or the existing contract test file) —
      "emits a Functions entry per exported function", "a trigger-
      synthesized function is absent", "a function returning a table the
      contract does not carry is absent". **Carried in from group 1**:
      `emit.ts`'s `EMPTY_SECTION` comment says the export carries no
      function signatures, which group 1 made false — this group's own
      edit is what corrects it, and it is a false statement in the tree
      until then, not a docs nit.
- [x] 2.2 (~9m) Determinism, the golden, and a real `tsc` over the new
      section. `examples/cli-smoke/test/vendored-contract.test.ts` is the
      only place a contract is type-checked by a real `tsc` against the
      installed package rather than asserted as strings — and its schema
      declares no function at all, so everything group 2 emits is
      currently unproven there: a `Functions` section that does not
      compile would pass every test this change has. Its fixture gains a
      scalar and a table-returning function (one argument keyed
      differently from its SQL name, one non-default numeric mode, so the
      emitted types are not all `string`). **This file is shared with
      group 3 by halves** — group 2 owns the type-check half, group 3
      owns the live-call half; the same split the emitter and its
      proof-of-execution already needed. Determinism: two vendor runs
      byte-identical with a function declared; `contract-authority.test.ts`
      and the existing determinism tests stay green. Failing test: the
      real-`tsc` run over an emitted `Functions` section, and the golden
      diff itself (regenerate deliberately, review the diff).

## 3. The client's fn and the witness (#587)
Files: `packages/query/src/client/name-keyed-db.ts`, `packages/query/src/
client/synthesize-function.ts` (new — **not** `synthesize.ts`, which a
parallel change is editing), `packages/query/src/client/contract-types.ts`
(it carries no `functions` field at all yet), `packages/query/src/db/fn.ts`
(reuse of the call plan; export what `fn` needs), `packages/query/test/
client/*.test.ts`, `examples/*/test/*vendor*.test.ts` (the two-repository
witness — its type-check half belongs to group 2), `skills/hejbro/
references/{query-layer,polyrepo}.md` (measure the file name),
`.changeset/*.md`

- [x] 3.1 (~9m) [design] `createNameKeyedDb` gains `fn`, keyed by export
      name, typed from `Database["Functions"]`, rendering through the
      same scalar-call / returns-table plan `db.fn` uses (no second
      renderer). **Two parities, and they are separate claims** (lead,
      2026-09-02): the *result types* agree, and the *rendered SQL and
      params* agree. A type equality says nothing about what reached the
      driver, and identical SQL says nothing about what the caller was
      allowed to write; either alone leaves the client "typed right and
      wired to different SQL", or the reverse. Failing tests:
      `client/parity.test.ts` — the existing recording-driver comparison
      of the declaration path against the vendored client, extended to a
      scalar call and a table-returning call (same SQL, same params, and
      the table return's explicit column list); `name-keyed-db.test.ts`
      — a type test "a mismatched argument fails", including 2.1's
      zero-argument `Record<string, never>` probe; and the type-equality
      half under one real `tsc`, the function-shaped sibling of the
      D106 m8 select check.
      The key-avoidance search needed a fixture built to make it work:
      the property it exists for also held for an unrelated reason
      (tables spread first, and table clients resolving by value rather
      than by name), so the search was unobserved code until two tables
      and two `setof`-returning functions were arranged such that
      skipping the search evicts one table and stopping it after a
      single attempt evicts the other. Both mutants now kill exactly one
      test, and they are different tests. The spread order keeps its own
      observer and a one-line constraint comment.
      The synthesized declaration fills the fields `createFnApi` never
      reads with honest minimums — the way the table synthesis already
      fills unread column fields — rather than earning a coded refusal
      of its own. That was measured, not assumed, and the measurement
      carries its date: on `dev` at `28e7010a`, the table precedent kept
      DDL away by reusing `existing: true`, and no refusal existed for a
      synthesized value; a parallel change is moving that table to
      `"usage"` authority so the `synced-table-declared` guard catches
      it. The conclusion outlives that move, because the protection here
      is not refusal but unreachability — the declaration escapes to no
      public surface at all, which is the stronger property. **That
      makes the leak test the one pillar under this decision**: if a
      later change ever exposes the synthesized declaration, the refusal
      question reopens with it.
- [x] 3.1b (~10m) A synthesized function is refused by the migration
      engine. **A measurement changed this decision** (lead, 2026-09-02):
      3.1 had settled for unreachability plus a leak test, on the
      reasoning that a value which escapes nowhere needs no refusal. Then
      the declaration was actually handed to `generateMigration` in a
      probe, and it was not rejected — it produced a migration creating
      the function with an empty body. A silent wrong DDL under the one
      pillar is a different risk from an error under it, so the pillar
      gets a second layer, the two-layer shape the vendored *table*
      already has. The synthesized declaration carries an authority
      marker and `generate.ts` refuses it at its single function
      chokepoint with `synced-function-declared`, keyed on the marker
      being `"usage"` and never on its absence — every `defineFunction`
      carries no marker at all and must stay unaffected. The leak test
      stays: one layer says it cannot get there, the other says what
      happens if it does. This opens a core file during group 3, which
      the groups' sequence permits; the reason it is not in group 1 is
      that the fact justifying it was not known then. Failing test: core
      — "a synthesized function handed to generateMigration is refused"
      (the probe, kept as a test).
- [x] 3.2 (~9m) The live witness: vendor the examples' schema into the
      consumer fixture and call one scalar and one table-returning
      function against PG15 and PG17. The live half does **not** go in
      the existing smoke file after all: that file runs in the default
      `pnpm test`, and putting a server call in it would make a package
      that needs no Docker suddenly need it, against the convention every
      other integration suite here follows. It lands as its own
      Docker-gated `*.integration.test.ts` with its own config and
      script — the same feature's live half, a different file.
      The witness seeds its rows through the driver rather than through
      the vendored client's own `insert`, following the workaround the
      two-repository witness already documents: that `insert` never
      calls `.returning()`, so it resolves empty while its type promises
      rows. Found live here, pre-existing — #622 fixed the chain types
      and did not reach the name-keyed wrapper's casts — and filed as
      #654. Out of scope for this change; the citation is here so the
      seeding is not read as an arbitrary choice.
- [x] 3.3 (~5m) Skill sentences (the contract now carries functions; call
      them through `fn` — and say that `Functions` is keyed by export
      name while `Tables` is keyed by SQL name, since a reader who meets
      one rule will assume the other), and a `minor` changeset — which
      CI cannot ask for: `changeset status` passes while any unconsumed
      changeset covers the fixed group, and fifty of them sit in
      `.changeset/` between releases, so its absence would never be
      reported (#652). The ledger rows and the README blocks are **not**
      this task: they are the lead's close-out commit at PR time, one
      writer for those files.
      **Carried in from 3.1**: `skills/hejbro/references/polyrepo.md:47`
      says what `createDb`'s value has is `columns`/`select`/`insert`/
      `update`/`delete` — 3.1 made that false by adding `fn`. It is a
      false statement sitting in the tree until this task, not a docs
      nit, and the rule it trips is "public surface changed → the skill
      moves in the same PR".

## Verification (definition of done, not a task)
`openspec validate emit-typed-functions --strict`; `openspec show
emit-typed-functions --diff` with zero "No matching main requirement"
warnings; `TURBO_FORCE=1 pnpm check / check-types / test / check:bans /
check:crap`; `pnpm build --force` then `pnpm --filter hejbro
test:integration` on both majors with zero skipped; the D106 gate before
archive.
