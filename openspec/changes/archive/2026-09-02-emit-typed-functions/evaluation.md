# D106 evaluation — emit-typed-functions

## Round 1

### Verdict

**BLOCKING 0 / NON-BLOCKING 7 / OK 9**

Every delta scenario in `schema-export` and `schema-vendoring` matches
shipped behavior. No scenario claims something the code does not do, and
no code path does something a scenario forbids. The seven non-blocking
findings are one same-version format-shape hazard, two unspecified
externally observable behaviors the change shipped without a delta, one
prose over-claim, and three latent/low-priority gaps.

### Blocking

None.

### Non-blocking

1. **Format 1 now has two shapes, and the older one is refused rather
   than read.** `functionFactSchema` makes `args` and `returns`
   **required** (`packages/cli/src/vendor/validate-export.ts:68-74`)
   while `EXPORT_DESCRIPTION_FORMAT` deliberately stays `1`
   (`packages/cli/src/export/format.ts:15`, whose doc comment this
   change rewrote to "never bump merely when a field is added"). A
   `.hejbro/export/schema.json` written by any pre-`#587` toolchain
   declares `descriptionFormat: 1` too, carries no `args`/`returns`, and
   is hard-refused — the refusal path is itself proved by
   `packages/cli/test/validate-export.test.ts:84` ("refuses an argument
   missing its declared type" → `/does not answer its own format/`).
   The unmodified main requirement *"A description format newer than the
   reader is refused"* (`openspec/specs/schema-vendoring/spec.md:283-306`)
   states the opposite intent — "A toolchain meeting an **older** format
   SHALL read it and treat the facts that format does not carry as
   absent" — and justifies having no older-format branch on the now-false
   premise that "the description format has held one shape (format 1)
   since it first existed". Concrete repro: consumer upgrades `hejbro`
   past `#587`, runs `hejbro vendor` against a linked schema repo whose
   committed export predates it → refusal instead of a contract with an
   empty `Functions` section. Neither delta covers this. Remedy is either
   optional-on-read `args`/`returns` (defaulting to `[]`/`null`) or a
   format bump with a real older-shape branch.

2. **`synced-function-declared` is a new externally observable refusal
   with no delta and no doc entry.** `packages/core/src/engine/generate.ts:85-90`
   adds a hard error to `generateMigration` for any `FunctionDeclaration`
   carrying `authority: "usage"` (the tag `synthesizeFunction` now
   applies, `packages/query/src/client/synthesize-function.ts:70`). It is
   tested (`packages/core/test/engine/function-authority-refusal.test.ts:43`)
   but neither `openspec/changes/emit-typed-functions/specs/*` nor any
   file under `openspec/specs/` nor `skills/hejbro/**` mentions it (grep:
   zero hits outside `src`/`test`). D87 requires a delta for a change to
   error text and behavior. Its table sibling `synced-table-declared` is
   equally unspecified, so this continues a pre-existing gap rather than
   opening one.

3. **`ContractMetadata.functions` became required with no runtime
   guard.** `packages/query/src/client/contract-types.ts:81` makes
   `functions` a required member and `createNameKeyedDb`
   (`packages/query/src/client/name-keyed-db.ts`, the
   `Object.entries(metadata.functions)` in the body) reads it
   unconditionally. A `contract.ts` vendored before this change carries
   no `functions` key, so pairing it with an upgraded `@hejbro/query`
   throws a raw `TypeError: Cannot convert undefined or null to object`
   — not one of this file's own contract-naming errors
   (`unknown-contract-table` / `unknown-contract-function`, which exist
   precisely because "errors name the contract, not internals"). tsc
   rejects it first for a type-checked consumer, so blast radius is
   small, but the runtime path is unguarded and unspecified.

4. **`A mismatched call fails the type check` over-claims for the
   "extra" case.** The scenario says an "extra" argument makes the call
   fail to compile. `NameKeyedFnCaller<TFn> = (args: TFn["Args"]) =>
   Promise<TFn["Returns"]>`
   (`packages/query/src/client/name-keyed-db.ts`, `NameKeyedFnCaller`)
   relies on TypeScript's excess-property check, which only fires on a
   fresh object literal — the test that covers it says so in its own name
   (`packages/query/test/client/fn-types.test.ts:77`, "…on a fresh object
   literal"). Counterexample: `const a = { postId: "x", extra: 1 };
   client.fn.postById(a)` compiles; the runtime then throws
   `function-argument-count-mismatch`
   (`packages/query/src/db/fn.ts`, `assertArgCount`). Missing and
   wrongly-typed arguments and a typo'd key *do* fail to compile
   (`fn-types.test.ts:56,63,70`). Parity with the declaring repository's
   own `db.fn` holds either way, so this is spec prose to tighten, not a
   divergence.

5. **`interval` reaches the emitted contract as an unresolved
   `IntervalValue`.** `packages/cli/src/contract/ts-type.ts:106` returns
   the bare identifier `IntervalValue`, and its own comment claims it is
   "named by import in the emitted module" — but `GENERATED_HEADER`
   (`packages/cli/src/contract/emit.ts:69`) imports only `Driver` and
   `createNameKeyedDb` from `"hejbro"`. A vendored contract with an
   `interval` column has always been uncompilable (pre-existing, `#314`);
   `#587` widens the reach of the same mapping to function `Args` and
   scalar `Returns` (`packages/cli/src/contract/functions.ts`,
   `argComputation` / `returnsComputation` both call `columnTsType`). No
   test emits a contract containing an `interval` anywhere.

6. **Argument TypeScript keys are emitted unquoted.**
   `renderFunctionArgsType` (`packages/cli/src/contract/functions.ts`)
   renders ``readonly ${arg.key}: ${arg.tsType};``. Core accepts a
   non-identifier declared key — `assertValidLocalName`
   (`packages/core/src/plpgsql/reserved.ts:106-118`) only rejects
   reserved words — so `defineFunction(app, "f", { args: { "my-arg":
   text() } }, …)` emits `readonly my-arg: string;` and the contract
   fails to compile. Same pre-existing pattern as table column keys
   (`packages/cli/src/contract/tables.ts:131`); the runtime metadata does
   quote correctly (`JSON.stringify(arg.key)`, `emit.ts`
   `renderFunctionClientMetaEntry`).

7. **The scoped `fn` observer checks that a transaction opened, not what
   ran inside it.** `packages/query/test/client/functions.test.ts:92`
   asserts `driver.transaction` was called once and the value converted;
   it never asserts the context SQL the scope applies. Scenario 1's
   "where the same invocation runs inside the context the scope applies"
   is therefore carried by code reuse (`internalDb.as(context).fn`) plus
   `db.as`'s own tests, not by a direct observer at the vendored surface.
   Unscoped SQL parity *is* directly observed
   (`packages/query/test/client/parity.test.ts:203,237`).

### Verified scenarios

**schema-export — MODIFIED "The export carries what the schema alone does not say"**

- **A synthesized trigger function carries no export name** — OK.
  `defineTrigger` builds its function with `returns: { returnsKind:
  "trigger" }` (`packages/core/src/dsl/define-trigger.ts:165`);
  `functionReturnsFact` maps that to `null` and `exportNames` never holds
  the inner declaration (`packages/cli/src/export/description.ts`,
  `functionReturnsFact` / `buildExportDescription`). Proved by
  `packages/cli/test/export-facts.test.ts:256` (no export name) and
  `:286` (no return shape).
- **A function's argument keys ride with its SQL names** — OK. Core keeps
  `key` beside `argName` in declaration order
  (`packages/core/src/dsl/define-function.ts`, `resolveArgs`); the export
  carries them as an ordered array, never a name-keyed map
  (`description.ts`, `functionArgFacts`). Proved by
  `export-facts.test.ts:109` (keys declared out of alphabetical order on
  purpose, `zebraId`/`alphaId`, and both return kinds asserted) and, on
  the read side, `packages/cli/test/validate-export.test.ts:22,62,119`.
- **An argument's declared type survives with its choices** — OK.
  `typeNode`/`mode`/`notNullElements` per argument and `typeNode`/`mode`
  for a scalar return (`description.ts`, `ExportFunctionArgFact` /
  `ExportFunctionReturnsFact`). Proved by `export-facts.test.ts:193`
  (`bigint({mode:"number"})` and `text().array().notNullElements()`).
- **A brand is not among the carried facts** — OK, unchanged.
  `export-facts.test.ts:314`.

**schema-vendoring — ADDED "The contract carries a typed function surface"**

- **A scalar function crosses the boundary** — OK. Entry keyed by export
  name with mapped `Args`/`Returns`
  (`packages/cli/src/contract/functions.ts`, `renderFunctionEntry`);
  parameterized `select <fn>($1, …) as "result"`
  (`packages/query/src/db/fn.ts`, `scalarCall`), reached through the same
  `createFnApi` the declaring repository uses. Proved by
  `packages/query/test/client/functions.test.ts:63` and `:92` (scoped),
  `parity.test.ts:203` (same SQL and params as local `db.fn`),
  `fn-types.test.ts:109` (resolves to the value, not an array),
  `packages/cli/test/contract-emit.test.ts:173`, and the live witness
  `examples/cli-smoke/test/vendored-contract.integration.test.ts:313`.
- **A table-returning function crosses the boundary** — OK. `Returns`
  renders `ReadonlyArray<Database["Tables"][<sql name>]["Row"]>`
  (`contract/functions.ts`, `renderFunctionReturnsType`); the SQL is an
  explicit column list built from the target table's own declared columns
  (`db/fn.ts`, `setofTableCall`). Proved by
  `packages/query/test/client/parity.test.ts:237` ("…with an explicit
  column list"), `fn-types.test.ts:102`, `contract-emit.test.ts:173`, and
  the live witness.
- **A mismatched call fails the type check** — OK for missing / typo'd /
  wrongly-typed arguments (`fn-types.test.ts:56,63,70,88,95`); see
  non-blocking 4 for the "extra" case.
- **A function returning an uncarried table is absent** — OK.
  `returnsComputation` resolves the return against the *exact* array
  `computeTables` built, so a table missing from `Tables` structurally
  cannot appear as a return, and the whole entry is dropped rather than
  partially typed (`contract/functions.ts`, `returnsComputation` /
  `functionComputation` / `computeFunctions`; `emit.ts`, `emitContract`).
  The same array feeds both `Database` and `contractMetadata`, so the
  `fn` callable disappears with the type entry. Proved by
  `contract-emit.test.ts:290` (asserts the whole emitted source, not just
  the interface).
- **A synthesized trigger function is absent** — OK. `functionComputation`
  returns `null` on `exportName === null`; the section then renders
  `readonly Functions: {};` (`emit.ts`, `renderFunctionsSection`),
  distinct from `Views`' `[key: string]: never` marker, and
  `contractMetadata.functions` is `{}`, so `NameKeyedFn<Database>` has no
  keys and the runtime guard reports "(none vendored)"
  (`name-keyed-db.ts`, `wrapWithFunctionGuard`). Proved by
  `contract-emit.test.ts:262` and `:255`.

**Requirement-level claims checked beyond the scenarios**

- `Functions` keyed by export name while `Tables` stays keyed by SQL name
  — OK: `renderFunctionEntry` keys on `fn.exportName`, `renderTableEntry`
  on `computation.table.name` (`contract/tables.ts:245`). Directly
  contrasted in `contract-emit.test.ts:173` (`"searchPosts"` for SQL
  `search_posts`, returning `Database["Tables"]["posts"]["Row"]`).
- Export-name / SQL-name collision — OK, and non-trivially so.
  `buildFunctionKeyMap` + `freeInternalKey` assign a colliding function a
  suffixed internal key inside `db()`'s merged schema record, tables are
  spread first so a function can never evict one, and the public `fn`
  façade is re-keyed back to export names (`name-keyed-db.ts`,
  `buildFunctionKeyMap` / `buildInternalSchema` / `buildFn`). The
  table-return lookup itself is by value, not by key
  (`db/fn.ts` → `findTable`). Proved by
  `packages/query/test/client/functions.test.ts:117` (one collision) and
  `:208` (recursive: the first fallback candidate is itself occupied, with
  table-returning functions so the eviction is observable).
- Argument matching by declared key, not by caller key order and not by
  re-deriving the SQL name — OK
  (`db/fn.ts`, `resolvePositionalArgs`), which is what makes a vendored
  declaration (where `key` and `sqlName` travel independently) callable at
  all. `synthesize-function.test.ts:36` proves the key survives synthesis.
- No declaration shape leaks into the public `fn` — OK
  (`packages/query/test/client/no-fn-leak.test.ts:33,39,45`).
- Local and vendored handles agree at the type level for both a scalar and
  a table-returning function, compiled by a real `tsc` against the
  installed package —
  `examples/cli-smoke/test/vendored-contract.test.ts:188` (the
  `LocalTotalPosts`/`VendoredTotalPosts` and
  `LocalPostById`/`VendoredPostById` `AssertEqual` probes), exercising a
  non-default numeric mode (`bigint({mode:"number"})`) and a key≠SQL-name
  argument (`postId` → `post_id`).
- Skill docs updated for the new surface — `skills/hejbro/references/polyrepo.md:50-58`
  documents `createDb(driver).fn.*`, `db.as(context).fn`, and the
  export-name keying of `Functions`.

### Method

- `npx openspec show emit-typed-functions --diff` from the repo root
  (216 lines; both delta capabilities read in full). Confirmed
  `openspec/changes/emit-typed-functions/specs/` holds exactly the two
  capabilities the diff rendered. `proposal.md`, `design`, `tasks.md`,
  PR/commit bodies and `blackbox/` were not read as evidence; the
  `openspec` CLI prints the proposal ahead of the diff, and that text was
  disregarded.
- Read as shipped surface: `packages/core/src/dsl/define-function.ts`,
  `packages/core/src/dsl/define-trigger.ts` (returns sentinel),
  `packages/core/src/engine/generate.ts`,
  `packages/core/src/plpgsql/reserved.ts`,
  `packages/cli/src/export/{description,write,format}.ts`,
  `packages/cli/src/vendor/validate-export.ts`,
  `packages/cli/src/contract/{emit,functions,tables,ts-type,read-snapshot}.ts`,
  `packages/query/src/client/{name-keyed-db,contract-types,synthesize-function}.ts`,
  `packages/query/src/db/{fn,db}.ts`, `skills/hejbro/references/polyrepo.md`,
  `openspec/specs/{schema-export,schema-vendoring}/spec.md`.
- Ran (all green):
  `pnpm --filter @hejbro/query exec vitest run test/client/{functions,fn-types,no-fn-leak,synthesize-function,parity,errors}.test.ts test/db/fn.test.ts`
  — 43 tests;
  `pnpm --filter @hejbro/core exec vitest run test/engine/function-authority-refusal.test.ts test/define-function.test.ts`
  — 26 tests;
  `pnpm --filter hejbro exec vitest run test/export-facts.test.ts test/contract-emit.test.ts test/types/contract-types.test.ts test/validate-export.test.ts`
  — 42 tests.
- Could not run in this checkout: `packages/cli/test/{contract-authority,export-write,export-determinism}.test.ts`
  and both `examples/cli-smoke/test/vendored-contract*.test.ts`. All of
  them spawn the built CLI and fail their own freshness guard
  (`@hejbro/core's dist/ is older than its src/ (stale build)`); the
  remedy is `pnpm build --force`, which would write into the shared
  checkout, so it was not run. Their assertions were read instead. The
  Docker-gated `*.integration.test.ts` live witness was likewise read,
  not executed.
- No `pnpm install` was run and no file other than this report was
  modified.

### Filed

Non-blocking findings 1–7 are tracked as sub-issues of the #623 follow-up tray: #657 (1), #658 (2), #659 (3), #660 (4), #661 (5), #662 (6), #663 (7). No finding blocks the archive.
