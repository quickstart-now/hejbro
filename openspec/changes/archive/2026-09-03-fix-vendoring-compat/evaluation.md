# Adversarial spec evaluation — fix-vendoring-compat

## Round 1

### Verdict

**BLOCKING 0 / NON-BLOCKING 5 / OK 8**

11 delta scenarios were checked (`schema-vendoring`: 3 ADDED requirements
carrying 4 scenarios, 2 MODIFIED requirements carrying 7). Every one of the
11 matches shipped behavior; 8 match with no finding attached, 3 carry a
non-blocking finding (missing observer, stale text, adjacent over-reach).
Nothing shipped contradicts a delta scenario.

### Blocking

None.

### Non-blocking

**N1 — A non-identifier function-argument key produces invalid migration SQL,
and this change's own fixture now declares one.**
The delta's "Every emitted key compiles" requirement is scoped to the
contract emitter and the contract does compile — but nothing in the delta
says the DDL side is out of scope, while the change's own real-`tsc`
fixture (`examples/cli-smoke/test/vendored-contract.test.ts:118`) now ships
`echoArg` declared as `defineFunction(app, "echo_arg", { args: { "my-arg":
uuid() }, … })` as a *real declaration*. `defineFunction` only checks
reserved words (`packages/core/src/dsl/define-function.ts:197` →
`assertValidLocalName`, `packages/core/src/plpgsql/reserved.ts:106`), and
`packages/core/src/plpgsql/render-body.ts:239` renders the argument name
unquoted. Measured (source, not dist), `generateMigration` over
`{ args: { "my-arg": uuid(), "2nd": text(), 'q"k': text() } }` emits:

```
create or replace function "app"."echo_arg"(my-arg uuid, 2nd text, q"k text)
…
	return my-arg;
```

— syntactically invalid Postgres (and the `q"k` case breaks quoting), with
no error from the CLI. So the change makes a declaration shape look
supported end-to-end when only its contract half is. Either the requirement
should say the DDL axis is out of scope and unchanged, or the DSL should
refuse the key. Follow-up, not a contradiction of the scenario as written.

**N2 — The column half of "A non-identifier key is quoted" has no real-`tsc`
observer in the repository.**
The scenario names two inputs: a declared function argument key, and "an
export whose table fact carries such a column key". Only the argument half
reaches a real compiler (`examples/cli-smoke`'s SCHEMA_SOURCE + `tsc
--noEmit --strict`); the column half is asserted as rendered *text* only
(`packages/cli/test/contract-emit.test.ts:408-482`), because D36's
`assertSqlName` makes the DSL structurally incapable of producing it. I
confirmed the claim out-of-tree (see Method: `user-id`, `1st`, `class`,
`a"b` emitted and compiled by a real `tsc` with zero errors), so the
scenario is true — the repository just never observes the half its own
scenario names first.

**N3 — The runtime clause of the rewritten mismatched-call scenario has no
observer.**
The MODIFIED scenario now ends "a pre-built value carrying an extra property
is refused at runtime before any SQL is sent". The compile-time clauses are
observed (`packages/query/test/client/fn-types.test.ts:55-100`: typo,
missing, wrongly typed, excess on a fresh literal). The runtime clause is
not: the nearest test, `packages/query/test/db/fn.test.ts:330`, exercises
the *local* `db.fn` surface with a *missing* argument, not the vendored
`fn` with an extra property. Verified true out-of-tree (rejects with
`function-argument-count-mismatch` and `driver.execute` is never reached),
so this is a missing observer, not a defect.

**N4 — Stale scenario title against the requirement's new prose.**
The MODIFIED "A description format newer than the reader is refused" deletes
the "Not yet observable, and recorded as such rather than promised…"
paragraph, but keeps the scenario titled "An older format is read
(unobservable until a second format exists)". The parenthetical now has no
supporting prose, and the new prose ("Format 1 now has two shapes…") is
about the *shape* axis, not the format-*number* axis that parenthetical
refers to. The older-number branch is still genuinely unobserved in the
suite — `packages/cli/test/vendor-states.test.ts:161,352` covers only
`descriptionFormat: 99`. (Behavior is correct: I measured
`descriptionFormat: 0` reading cleanly through `validateExport`.) A reader
of the merged spec cannot tell whether this branch is now claimed as
closed.

**N5 — `vendor --check` never re-emits, so a contract these fixes would
change keeps reporting "up to date".**
`runVendorCheck` (`packages/cli/src/commands/vendor.ts:93-118`) is offline
and hash-only: it compares the three vendored files against
`hejbro.lock`'s recorded hashes and never calls `emitContract`. A consumer
who vendored an `interval` column before this change, then upgrades
`hejbro`, keeps a `contract.ts` with no `IntervalValue` import — it still
does not compile, and `vendor --check` still says
`vendor --check: up to date`. `outdated` (`commands/outdated.ts`) never
reads the payload at all, so it is unaffected by every export shape tested
here. "Every emitted key compiles" reads as an unconditional promise about
vendored contracts; nothing routes an already-vendored consumer to
re-`vendor`. Low severity, documentation-shaped.

### Verified scenarios

1. **A bare insert resolves to no rows, and says so in its type** — OK.
   Exact type equality proved with a strict `Equals` (conditional-type
   identity, not assignability) against source: `Awaited<ReturnType<typeof
   client.posts.insert>>` ≡ `ReadonlyArray<never>`, and the same for
   `update()`, `delete()`, `update().where()`. Runtime `[]` with no
   `RETURNING` in the sent SQL: `packages/query/test/client/
   mutation-result.test.ts` (7 tests, passing). Surface:
   `packages/query/src/client/name-keyed-db.ts:66-118`.
2. **A pre-functions contract still builds a client** — OK.
   `metadata.functions` is optional (`contract-types.ts:88`) and read as
   `metadata.functions ?? {}` (`name-keyed-db.ts`, `createNameKeyedDb`).
   `packages/query/test/client/legacy-metadata.test.ts` passes. I also
   reconstructed a *real* pre-#587 `contract.ts` byte-shape from
   `git show 518dcdde:packages/cli/src/contract/emit.ts` (its `Database`
   carries `Functions: { [key: string]: never }` and its
   `contractMetadata` carries neither `source` nor `functions`) and
   compiled it plus a consumer with a real `tsc` — zero errors, so the
   `DatabaseShape` constraint does not reject the legacy interface.
   Runtime: unknown `fn` refuses with `code:
   "unknown-contract-function"` and `Vendored functions: (none vendored)`.
3. **A non-identifier key is quoted** — NON-BLOCKING (N1, N2).
   `renderKey` (`packages/cli/src/contract/tables.ts:120-131`) quotes via
   `JSON.stringify` when the key fails `/^[A-Za-z_$][A-Za-z0-9_$]*$/`,
   shared by `Row`/`Insert`/`Update` and by a function's `Args`
   (`contract/functions.ts:158`). Adversarial keys `user-id`, `1st`,
   `class` (reserved word — correctly left unquoted, legal as a type
   member key), `a"b` (escapes to `"a\"b"`), and argument keys `my-arg`,
   `2nd`, `q"k` all emit and compile. Key text is preserved verbatim.
4. **An interval column compiles** — OK. `INTERVAL_VALUE_IMPORT_LINE` is
   added exactly when `contractNamesInterval` is true
   (`contract/emit.ts:113-124, 296-320`), decided over each carried
   `TypeNode` (`ts-type.ts:32-41`), not a text scan. Matrix measured:
   column-only ✓, argument-only ✓, scalar-return-only ✓, `interval[]`
   column ✓, nowhere → no import ✓. Both the `git` and `database`
   (`pull`) headers get it. Real-`tsc` observer:
   `examples/cli-smoke`'s SCHEMA_SOURCE declares both an `interval`
   column and an `interval` argument.
5. **A newer format is refused with the command that fixes it** — OK.
   `assertDescriptionFormatSupported` (`vendor/validate-export.ts`)
   throws `vendor-export-format-unsupported` naming the declared version,
   this toolchain's version, and `npm install -g hejbro@latest`.
   Observed by `packages/cli/test/vendor-states.test.ts:161`; reproduced
   with `descriptionFormat: 99`.
6. **An older format is read (unobservable until a second format exists)**
   — NON-BLOCKING (N4). Behavior correct: `descriptionFormat: 0` parses
   and reads. A newer `snapshotFormat` is deliberately *not* refused by
   this guard (that axis belongs to `parseSnapshot`), consistent with the
   requirement's wording ("description format").
7. **A pre-functions export reads with its functions absent** — OK.
   `functionFactSchema` makes `args`/`returns` optional
   (`validate-export.ts`), and `functionComputation`
   (`contract/functions.ts:117-131`) drops the fact when *either* is
   `undefined`. Measured all four shapes: no `args`+no `returns` →
   dropped; `args` only → dropped; `returns` only → dropped;
   `functions: []` → `readonly Functions: {};`. Tables are carried in
   every case. Observers: `packages/cli/test/validate-export.test.ts:190`,
   `packages/cli/test/contract-emit.test.ts` ("a pre-functions fact drops
   out of the contract"). Note: a `functions` key missing *entirely* is
   refused — correctly, since `ExportDescription` has carried `functions`
   since the first export writer (`git show 8f26bf12:packages/cli/src/
   export/description.ts`), so no such format-1 file exists.
8. **A scalar function crosses the boundary** — OK (unchanged by the
   delta). `packages/query/test/client/functions.test.ts:63`;
   `examples/cli-smoke`'s D106-m8 parity check compares
   `localHandle.fn.totalPosts` against `vendoredHandle.fn.totalPosts` as
   whole call signatures under a real `tsc`.
9. **A table-returning function resolves to typed rows with columns listed
   explicitly** — OK (unchanged). `renderFunctionReturnsType`
   (`contract/functions.ts:165-171`) →
   `ReadonlyArray<Database["Tables"][…]["Row"]>`; parity check pins
   `postById` both ways.
10. **A mismatched call fails the type check** — NON-BLOCKING (N3). The
    three compile-time clauses hold exactly as rewritten, including the
    "fresh object literal" qualifier the delta added (excess-property
    check); the runtime clause holds but is unobserved.
11. **A function returning an uncarried table is absent** — OK
    (unchanged). `returnsComputation` returns `null` when the returned
    table is not in the already-computed `tables` array
    (`contract/functions.ts:88-110`);
    `packages/cli/test/contract-emit.test.ts:303`.

Determinism: `emitContract` is a pure function of `(payload, origin)` —
re-verified byte-identical output over the hostile-key payload, and no
clock/machine/path reaches it.

### Method

Context-free. Read only: `openspec show fix-vendoring-compat --diff`,
`packages/cli/src/{vendor,contract}/*`, `packages/query/src/client/*`,
`packages/query/src/db/fn.ts`, the named test files,
`skills/hejbro/references/{polyrepo,query-layer}.md`,
`.changeset/fix-vendoring-compat.md`, and (for the legacy shape only)
`git show <sha>:<path>` of two pre-#587 source files. No proposal,
design, tasks, PR body, commit message, `blackbox/`, or `.agents/`.

Tests run (targeted, no `pnpm build`/`install`, no full-workspace gate):

- `pnpm --filter @hejbro/query exec vitest run test/client/{legacy-metadata,mutation-result,functions}.test.ts` — 13 passed.
- `pnpm --filter hejbro exec vitest run test/{validate-export,contract-emit}.test.ts` — 31 passed.

Out-of-tree probes, in a throwaway project under `/private/tmp` (deleted
afterwards; nothing written into the repository), because type-level and
compile claims cannot be observed by vitest:

- A `tsconfig.json` with `paths` mapping `hejbro`/`@hejbro/core`/
  `@hejbro/query` to their **source** entry points, and `tsc --noEmit
  --strict` over: (a) the emitted hostile-key contract plus a consumer
  using `client.posts.columns["user-id"]`, `["1st"]`, `.class`, `['a"b']`,
  `client.fn.echoArg({"my-arg", "2nd", 'q"k'})`, and strict `Equals<…,
  ReadonlyArray<never>>` assertions for `insert`/`update`/`delete`;
  (b) a reconstructed pre-#587 `contract.ts` and its consumer. Both: zero
  errors.
- A vitest project rooted in `/private/tmp` with the repo's own
  `@hejbro/core`/`@hejbro/query` source aliases, driving `emitContract`,
  `validateExport`, `createNameKeyedDb` and `generateMigration` directly
  over the constructed inputs above.

**Environment note (not a finding against the change):**
`examples/cli-smoke/test/vendored-contract.test.ts` — the real-`tsc`
observer for scenarios 3, 4, 8, 9 — cannot run in this checkout: all four
of its cases fail at `hejbro generate --export` with `TypeError: handler
is not a function` inside `packages/core/dist/index.js`. `dist` is dated
Aug 29 against a `src` dated Sep 2; the same declarations pass through
`generateMigration` from source. A build was deliberately not run (another
team holds the gate slot), so those scenarios' compile claims were
re-observed with the out-of-tree `tsc` runs above instead.

## Round 1 disposition

All five non-blocking findings are addressed on `fix-vendoring-d106-r1`
(`2ca69702` docs, `157f75e2` tests). No shipped behavior changed: every
fix either adds an observer the repository was missing or states a scope
the delta had left implicit.

**N1 — scope stated, the DDL gap left where it belongs.** "Every emitted
key compiles" now says in the delta that it covers the emitted contract
only, that the DDL side renders such an argument name unquoted, and that
a declaration carrying one still produces invalid migration SQL. The
`examples/cli-smoke` fixture's `my-arg` declaration carries a
constraint-only comment pointing at #679, which the lead filed with the
measured SQL. The requirement is not widened here: closing the gap means
refusing a declaration shape, which is #679's decision to make.

**N2 — the column half now reaches a real compiler.** The observer enters
through the emitter's *other* input contract rather than the DSL, which
D36 makes structurally incapable of producing such a key: the smoke test
patches the `.hejbro/export/schema.json` table-fact column keys
(`user-id`, `1st`, `class`, `a"b`) before `git commit` → `link` →
`vendor`, then compiles the emitted contract with a real `tsc --noEmit
--strict`. That is the path the scenario's WHEN already names ("an export
whose table fact carries such a column key is read"), and a hand-edited
`schema.json` is a real artifact — the reader validates `key` as
`z.string()`, with no shape check.

**N3 — the runtime clause is pinned.** A vendored `fn` called with a
**pre-built** value (not a fresh object literal, so no excess-property
check applies) carrying an undeclared property is refused with
`function-argument-count-mismatch`, and the test asserts the driver's
`execute` was never called — the "before any SQL is sent" half, which a
rejection-code assertion alone would not prove.

**N4 — prose restored rather than the branch pinned.** The scenario title
"(unobservable until a second format exists)" is kept, and the
requirement carries again the justification it had lost, now separating
the two skew axes: the format-**number** axis stays structural (the
description format has only ever been 1, so no export declaring a lower
number was ever written, and the suite pins only the refusal side), while
the **shape** axis is observed. Pinning was rejected on substance, not
cost. First, a `descriptionFormat: 0` fixture would be a fabricated
artifact, and this change's own discipline is that a compatibility
promise is proven only by a genuine old-shape artifact — the pre-#587
`schema.json` fixture was hand-written from `git show 518dcdde:…` for
exactly that reason. Second, a pin would make the title's parenthetical
false, and a MODIFIED delta cannot rename a scenario (renaming is
REMOVED + ADDED), so it would trade one mismatch for another this change
could not repair.

**N5 — the upgrade path is documented.**
`skills/hejbro/references/polyrepo.md` now says that after upgrading
`hejbro` a consumer re-runs `vendor` to re-emit, because `vendor --check`
compares recorded hashes and never re-emits, so a contract these fixes
would change keeps reporting "up to date".

**Observer status.** N3 and the delta/doc edits are green here
(`packages/query/test/client/functions.test.ts`, targeted runs;
`openspec validate --strict` valid, `show --diff` zero warnings, and both
MODIFIED requirements still classify as MODIFIED after the prose edits).
N2's observer **depends on built `dist`** — it spawns the built CLI. It
passed in this worktree against the `dist` the group's own slot build
produced, with no rebuild attempted (the team held no gate slot), and the
reviewer's `TypeError: handler is not a function` did not reproduce. Its
authoritative green is the lead's closing gate, which runs `build --force`
before the full suite.

## Round 2

### Verdict

**BLOCKING 0 / NON-BLOCKING 3 / OK 8**

The same 11 delta scenarios were re-checked against the merged correction
(`schema-vendoring`: 3 ADDED requirements carrying 4 scenarios, 2 MODIFIED
carrying 7). Nothing shipped contradicts a delta scenario outright, so the
verdict stays non-blocking; 8 scenarios match with no finding attached, 3
carry one. All five round-1 findings are closed in the text and the code —
but the clause round 1's N3 asked to be pinned turns out itself to
over-claim (R2-N1), the newly-widened key requirement has one more silent
hole on the same hand-edited-export axis the correction legitimized
(R2-N2), and the correction's headline observer cannot be executed on
`dev` at all (R2-N3).

### Round-1 findings re-checked

- **N1 (DDL gap unscoped) — CLOSED.** "Every emitted key compiles" now
  carries the scope paragraph, and the paragraph's factual claim is
  accurate as written: measured from source, `generateMigration` over
  `{ args: { "my-arg": uuid(), "2nd": text(), 'q"k': text() } }` emits
  `create or replace function "app"."echo_arg"(my-arg uuid, 2nd text, q"k
  text)` with no error — invalid Postgres, exactly as the paragraph says.
  The scope is stated for the *function-argument* axis only, which is
  correct: `table()`'s own `assertSqlName` still refuses a `user-id`
  column key with `invalid-sql-name`, so no DDL gap exists on the column
  axis to scope out. The `examples/cli-smoke` fixture carries the
  constraint-only comment pointing at #679.
- **N2 (column half had no real-`tsc` observer) — CLOSED in code,
  UNVERIFIED in this checkout.** The observer exists at
  `examples/cli-smoke/test/vendored-contract.test.ts:272` and takes the
  path the scenario's WHEN names (patch the committed `schema.json`'s
  table-fact column keys → `link` → `vendor` → real `tsc --noEmit
  --strict` over the contract *and* a consumer touching
  `columns["user-id"] / ["1st"] / .class / ['a"b']`). It cannot run here
  — see R2-N3. Re-verified independently out-of-tree instead (real `tsc`,
  zero errors).
- **N3 (runtime clause unobserved) — CLOSED, but the clause it pins
  over-claims.** `packages/query/test/client/functions.test.ts:155`
  passes, asserts `function-argument-count-mismatch`, and asserts
  `driver.execute` was never called. The observer is exactly what N3
  asked for. See R2-N1 for what the pinned sentence does *not* cover.
- **N4 (stale scenario title vs deleted prose) — CLOSED.** Both halves of
  the restored two-axis paragraph check out. Format-number axis:
  `EXPORT_DESCRIPTION_FORMAT` reads `1` in every commit that has ever
  carried `export/format.ts` (`8f26bf12`, `518dcdde`, `62c37e8e`,
  `0e9bb08a`, `HEAD`), so no genuine export declaring a lower number was
  ever written, and the suite does pin only the refusal side
  (`vendor-states.test.ts:161,352`, `descriptionFormat: 99`, the only
  skew fixture in `packages/cli/test`). Shape axis: `functions[].args`/
  `returns` entered at #587 (`62c37e8e`, `0e9bb08a`) with the format
  number left at 1, so "format 1 now has two shapes" is literally true.
  Behavior re-measured: `descriptionFormat: 0` and `-3` both read
  cleanly.
- **N5 (`vendor --check` never re-emits) — CLOSED as documented.**
  `skills/hejbro/references/polyrepo.md:29-34` now carries the sentence,
  and it describes the code accurately: `runVendorCheck`
  (`packages/cli/src/commands/vendor.ts:96-118`) compares three sha256
  hashes against `hejbro.lock` and never calls `emitContract`; `runOutdated`
  (`commands/outdated.ts:26-70`) compares only `lock.commit` against the
  remote head and never reads the payload. So `vendor --check` reports
  "up to date" and `outdated` reports "up to date" for every export shape
  probed in this round, and only re-running `vendor` re-emits.

### Blocking

None.

### Non-blocking

**R2-N1 — the rewritten mismatched-call scenario's runtime clause is
unconditional, but the guard behind it is count-only, and a pre-built
value carrying an extra property can be sent.**
The MODIFIED requirement's new paragraph says "a pre-built value carrying
one is refused at runtime by the argument-count check, never sent", and
the scenario's THEN repeats it: "a pre-built value carrying an extra
property is refused at runtime before any SQL is sent". The guard is
`assertArgCount` (`packages/query/src/db/fn.ts:170-179`), which compares
`Object.keys(namedArgs).length` against `declaration.args.length` and
nothing else — its own comment says so ("A mismatched *name* (typo, wrong
key) is TypeScript's job to reject before this ever runs"). Measured
against a two-argument vendored function (`status`, `maxRows`) with a
pre-built `{ status: "published", extra: "not declared" }`: the count is
2, the guard passes, and the client sends

```
select "app"."search_posts"($1, $2) as "result"   params: ["published", null]
```

— the extra property silently dropped, the declared argument it displaced
silently `null`. The control (`{status, maxRows, extra}`, count 3) is
refused with `function-argument-count-mismatch` and nothing is sent, as
the shipped observer pins.

Why non-blocking and not blocking: no *type-checked* call site can reach
it. `{ status: string; extra: string }` is not assignable to
`{ status: string; maxRows: number }` (the missing key fails first), so
TypeScript rejects the balanced shape at the call site; the probe had to
cast (`as never`). The hole is reachable only from an untyped caller — a
JS consumer, an `any`-typed value, `JSON.parse(body)` handed straight to
`client.fn.x(...)` — which is a real consumer of a published package but
outside what the scenario's own "where TypeScript can see it" framing is
about. Fix is a wording qualifier (the guard refuses when the argument
*count* then differs) or a name-based check; either way the delta
currently promises more than the code delivers.

**R2-N2 — `__proto__` as a column key compiles but silently loses the
column at runtime.**
`renderKey` (`contract/tables.ts:140-145`) leaves `__proto__` unquoted in
the type (correctly — it *is* a valid TS identifier), while
`renderTableClientMetaEntry` (`contract/emit.ts:195`) renders the metadata
entry as `JSON.stringify(tsKey)` → `"__proto__": { … }`. A quoted
`"__proto__"` in an object *literal* is a `[[SetPrototypeOf]]`, not an own
property (verified in node: `Object.keys({"a":1,"__proto__":{…},"b":2})`
is `["a","b"]`). Measured end to end: the emitted `Row` declares `readonly
__proto__: string;`, the contract compiles, and yet
`Object.keys(client.posts.columns)` is `["id","user-id",""]` and the
compiled statement is `select "id", "user_id", "empty_key" from
"app"."posts"` — `proto_key` is neither reachable nor selected, and
`contractMetadata.tables.posts.columns` has picked up a bogus prototype.
The same shape would hit a table SQL-named `__proto__` and a function
export-named `__proto__` (both rendered as object-literal keys); the
function *argument* metadata is an array of `{key}` records and is safe.

Strictly the delta is not contradicted: `__proto__` is an identifier, so
it is not "a non-identifier key", and the requirement's own promise ("the
contract compiles") holds. But the requirement's headline is unconditional
("Every emitted key compiles … whatever the schema declared"), and the
correction's own disposition just legitimized the hand-edited
`schema.json` as "a real artifact" on exactly this input axis — the same
edit that produces `user-id` produces `__proto__`. Follow-up, same family
as round 1's N1/N2: either quote-escape this key in the metadata
(`["__proto__"]` computed form, or `Object.defineProperty`) or refuse it
on read.

**R2-N3 — the correction's headline observer cannot be executed on `dev`;
`packages/core/dist` is behind its `src`.**
All five cases in `examples/cli-smoke/test/vendored-contract.test.ts`
fail here, including the new N2 column-key observer. Root cause measured,
not guessed: running the built CLI by hand over a schema declaring any
`defineFunction` throws

```
TypeError: handler is not a function
    at renderTypeNode (packages/core/dist/index.js:1768:9)
    at renderFunctionReturnsClause (…:5421:25)
    at generateMigration (…:8281:19)
```

while the identical declarations pass through `generateMigration` from
source in-process. The three CLI subprocess suites touched by this change
(`vendor-states`, `vendor-check`, `outdated`) fail earlier still, on their
own explicit `assertFreshBuild` ("dist/ is older than its src/"). So the
round-1 disposition's claim that the N2 observer "passed in this worktree"
is not reproducible on `dev` at ed7fa91e, and every real-`tsc` and
subprocess claim in this change rests entirely on the closing gate's
`pnpm build --force`. Recorded so the gate is not treated as a formality:
if it is run without `--force`, turbo can replay the stale logs and none
of these observers will have run anywhere.

### Verified scenarios

1. **A bare insert resolves to no rows, and says so in its type** — OK.
   Exact type identity proved with a strict conditional-identity `Equals`
   (`(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 :
   2)`), not `expectTypeOf` and not assignability, under a real `tsc
   --noEmit --strict` over an emitted contract with `hejbro` mapped to
   source: `insert`, `update`, `delete` and `update().where()` are each
   exactly `ReadonlyArray<never>`, and the `select()` control is *not*
   (pinned `= false`, so the assertion is load-bearing). Runtime: the
   sent statement carries no `returning`
   (`packages/query/test/client/mutation-result.test.ts`, 7 tests,
   passing). Note for the record, not a finding: `insert` passes the
   driver's rows through untouched (`name-keyed-db.ts:206`), so "resolves
   to an empty array" is a property of a conformant driver over a
   no-`RETURNING` statement, not of this layer — the identical wording
   already stands in `query-type-inference`'s own "A mutation without
   returning resolves to no rows", so this change introduces no new claim.
2. **A pre-functions contract still builds a client** — OK. `functions`
   is optional (`contract-types.ts:77`) and read as `metadata.functions ??
   {}` (`name-keyed-db.ts:429`). Measured on metadata with the key
   genuinely absent: `Object.keys(client.fn)` is `[]`, tables select
   normally, and an unknown call throws `code:
   "unknown-contract-function"` with `Vendored functions: (none
   vendored)`. Also compiled a reconstructed pre-#587 `contract.ts`
   (`Functions: { [key: string]: never }`, metadata with neither `source`
   nor `functions`) under a real `tsc`: zero errors. Worth stating
   precisely, since the scenario says "`fn` carries no callables" — that
   legacy index signature makes `keyof client.fn` be `string`, not
   `never`, but every entry types as `(args: never) => Promise<never>`, so
   no call site can be written at all (`client.fn.whatever({})` fails with
   TS2345, pinned as a negative control). The scenario holds.
3. **A non-identifier key is quoted** — NON-BLOCKING (R2-N2, R2-N3).
   Both halves re-measured. Column keys `user-id`, `1st`, `class`
   (identifier, correctly unquoted), `a"b` (→ `"a\"b"`), `""` and
   `__proto__` all emit; argument keys `my-arg`, `2nd`, `q"k`, `""` all
   emit under `renderKey` (shared by `Row`/`Insert`/`Update` and
   `functions.ts:173`). A real `tsc --noEmit --strict` accepts the emitted
   contract *and* a consumer reading `columns["user-id"]`, `["1st"]`,
   `.class`, `['a"b']`, `[""]` and calling `fn.echoArg({"my-arg", "2nd",
   'q"k', ""})` — zero errors. Keys are preserved verbatim. The runtime
   hole is `__proto__` only (R2-N2).
4. **An interval column compiles** — OK (observer caveat: R2-N3). Real
   `tsc` over an emitted contract declaring an `interval` column, an
   `interval[]` column, an `interval` function argument and an `interval`
   scalar return: zero errors, with `Row["checkIn"]` exactly
   `IntervalValue | null`, `Row["spans"]` exactly `ReadonlyArray<Interval
   Value | null> | null`, and `fn.gap()` exactly `IntervalValue`, each
   proved by conditional-identity equality. Import matrix re-measured
   over `contractNamesInterval` (`emit.ts:325-342`): column-only ✓,
   argument-only ✓, scalar-return-only ✓, `interval[]` ✓, nowhere → no
   import ✓. Two adversarial cases the matrix had not covered, both
   correct: an `interval` argument on a function *dropped* for a
   pre-functions fact adds no import, and an `interval` argument on a
   function dropped because its table return is uncarried adds no import
   (the check runs over the post-drop computed arrays, not the payload).
   `IntervalValue` is the only non-global value type the emitter can
   name (`Date`/`Uint8Array` are lib globals), so "imports every value
   type its own output names" is satisfied exhaustively.
5. **A newer format is refused with the command that fixes it** — OK.
   `descriptionFormat: 2` throws `vendor-export-format-unsupported`
   naming the declared version, this toolchain's `1`, and `npm install -g
   hejbro@latest`. Contract writing happens after `fetchExport`
   (`commands/vendor.ts:199`), so nothing is written.
6. **An older format is read (unobservable until a second format exists)**
   — OK. `descriptionFormat: 0` and `-3` both read; the title's
   parenthetical is now backed by the restored prose (see N4 above). A
   newer `snapshotFormat` (99) is deliberately not refused by this guard
   — that axis belongs to `parseSnapshot`, consistent with the
   requirement's "description format" wording.
7. **A pre-functions export reads with its functions absent** — OK.
   Measured every shape through `validateExport` then `emitContract`:
   both keys absent → read as `{schemaName, functionName, exportName}`
   and dropped, `Functions: {};`; `args` only → dropped; `returns` only →
   dropped; `returns: null` (trigger) → dropped; `functions: []` →
   `Functions: {};`. Tables are carried in every case. A `functions` key
   missing *entirely* is refused as `vendor-export-invalid` — correct,
   and independently confirmed: `ExportDescription` has carried
   `functions` since `8f26bf12`, the first commit with the file, so no
   real format-1 export lacks it. Observers are in-process at both
   pipeline stages (`validate-export.test.ts:190`,
   `contract-emit.test.ts:508`, 31 tests passing); the WHEN names
   `hejbro vendor`, and `vendor` reaches both by a direct two-call path
   (`fetch.ts:62` → `commands/vendor.ts:199`), but no subprocess observer
   composes them end to end.
8. **A scalar function crosses the boundary** — OK (unchanged by the
   delta). `packages/query/test/client/functions.test.ts` passing;
   `cli-smoke`'s whole-signature parity check is the real-`tsc` half and
   is blocked by R2-N3.
9. **A table-returning function resolves to typed rows with columns
   listed explicitly** — OK (unchanged). `renderFunctionReturnsType`
   (`functions.ts:178-185`) →
   `ReadonlyArray<Database["Tables"][…]["Row"]>`; `db/fn.ts:100-107`
   renders the column list explicitly, never `select *`.
10. **A mismatched call fails the type check** — NON-BLOCKING (R2-N1).
    All four compile-time clauses hold exactly as rewritten, including
    the "fresh object literal" qualifier
    (`packages/query/test/client/fn-types.test.ts:55-100`, passing). The
    runtime clause is now observed but is over-claimed.
11. **A function returning an uncarried table is absent** — OK
    (unchanged). Re-measured: dropping the returned table from
    `payload.tables` drops the whole function (`functions.ts:104-112`),
    and the drop is what keeps its `interval` argument from adding an
    import (scenario 4).

Determinism: `emitContract` is a pure function of `(payload, origin)` —
re-verified byte-identical (1627 bytes, `===`) across two calls over
independently deserialized copies of the same payload; no clock, machine
or path reaches it.

### Method

Context-free. Read only: `openspec show fix-vendoring-compat --diff`,
`openspec/specs/{schema-vendoring,query-type-inference}/spec.md`,
`packages/cli/src/{vendor,contract,commands/vendor.ts,commands/outdated.ts}`,
`packages/query/src/{client,db/fn.ts,db/execute.ts}`, the named test
files, `examples/cli-smoke/test/vendored-contract.test.ts`,
`skills/hejbro/references/polyrepo.md`,
`.changeset/fix-vendoring-compat.md`, and `git show <sha>:<path>` of
`export/{description,format}.ts` at five commits (format-number history
only). No proposal, design, tasks, PR body, commit message, `blackbox/`,
or `.agents/`. `openspec validate fix-vendoring-compat --strict`: valid.
`evaluation.md`'s round-1 section and disposition were read as claims and
each was re-measured independently.

Tests run (targeted; no `pnpm build`, no `pnpm install`, no
full-workspace gate):

- `pnpm --filter @hejbro/query exec vitest run test/client/{mutation-result,legacy-metadata,functions,fn-types}.test.ts` — 23 passed.
- `pnpm --filter hejbro exec vitest run test/{validate-export,contract-emit}.test.ts` — 31 passed.
- `pnpm --filter hejbro exec vitest run test/{vendor-states,vendor-check,outdated}.test.ts` — 3 files failed on `assertFreshBuild` before any assertion (read, not fixed).
- `pnpm --filter cli-smoke exec vitest run test/vendored-contract.test.ts` — 5/5 failed; root-caused to stale `packages/core/dist` (R2-N3).

Probes (each created, run and deleted in a single command; `git status`
shows no probe file):

- `packages/cli/test/_r2probe{,2,3}.test.ts` — drove `emitContract`,
  `validateExport` and `generateMigration` from source over: `functions:
  []`; function facts missing `args`, `returns`, both, and `returns:
  null`; the interval matrix including the two drop cases; hostile column
  keys (`user-id`, `1st`, `class`, `a"b`, `__proto__`, `""`) patched into
  a real export's table fact; hostile argument keys through the real DSL;
  `descriptionFormat` 0 / −3 / 1 / 2 and `snapshotFormat` 99; a
  `schema.json` with `functions` deleted; determinism.
- `packages/query/test/client/_r2probe.test.ts` — drove
  `createNameKeyedDb` over metadata with no `functions` member, over a
  `__proto__` column key, and over the balanced extra-property call
  (R2-N1), recording the exact SQL and params the recording driver
  received.
- `/private/tmp/_r2probe-tsc` (deleted) — a `tsconfig.json` mapping
  `hejbro`/`@hejbro/core`/`@hejbro/query` to their **source** entry
  points, `tsc --noEmit --strict --moduleResolution bundler`, over the
  emitted hostile-key contract, the emitted interval contract, a
  reconstructed pre-#587 contract, and consumers carrying
  conditional-identity `Equals` assertions plus two negative controls
  (`select()` ≠ `ReadonlyArray<never>`; `client.fn.whatever({})` on a
  legacy contract must not compile). Both controls behaved as required.
- `/private/tmp/_r2smoke` (deleted) — ran the built `packages/cli/dist/cli.js`
  by hand to root-cause R2-N3.
