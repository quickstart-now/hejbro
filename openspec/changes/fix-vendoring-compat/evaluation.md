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
