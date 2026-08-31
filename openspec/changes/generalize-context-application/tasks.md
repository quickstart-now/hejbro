# Tasks: generalize-context-application (#553)

Groups are parallel-safe: no two groups touch the same file. Estimates
are pure work minutes. `[design]` tasks sit at the end of their group and
settle a contract detail before the code that depends on it is written.

Execution order (single implementer, so sequential — the order is chosen
so each group's tests mean what they claim): **1 → 4 → 2 → 3 → 5**.
Group 4 comes early on purpose: it pins the existing drivers' *current*
statements, so those pins are a baseline established before the
generalization, not an after-the-fact approval of whatever changed.

Base: `f9c16be042fa15955e4f4ed9630fed643d88a792`.

## 1. Driver contract surface (#554)
Files: `packages/query/src/driver/contract.ts`,
`packages/query/test/driver/contract.test.ts`

- [x] 1.1 (8m) Optional context-rendering member on `Driver`. Failing
      test: a driver value carrying a rendering type-checks, and the
      return type extracted with `infer` is `ReadonlyArray<CompileResult>`
      — extraction assertion, never a whole-object type compare.
- [x] 1.2 (6m) Role-less-platform declaration. Failing test: the
      declaration is readable as data on the value; a driver that omits
      it is typed and read as "this platform has roles".
- [x] 1.3 (6m) Context-mandatory declaration. Failing test: readable
      before any connection; omission leaves today's typing untouched.
- [x] 1.4 (7m) Neither addition joins the capability set. Failing test:
      `DriverCapabilities` still requires exactly the two keys, and a
      capabilities object naming either new property fails to type-check
      (type mutant, not a value assertion).
- [x] 1.5 (5m) `[design]` Final member names and signatures (settled
      leaning: optional `Driver` members; rendering returns
      `ReadonlyArray<CompileResult>`; the two declarations are separate
      properties, not implied by the rendering's presence). Settled:
      `renderContext`, `roleLessPlatform`, `contextRequired`. The
      rendering's parameter type is a temporary `ContextValue` declared in
      `driver/contract.ts` (G1 cannot touch `db/context.ts`, and the
      reverse import direction would be a layer inversion) — task 2.10
      collapses it into `DbContext` once G2 owns `context.ts`.

## 2. Context application in the query layer (#555)
Files: `packages/query/src/db/context.ts`,
`packages/query/test/db/context.test.ts`,
`packages/query/test/db/context-provider.test.ts`

- [x] 2.1 (9m) Extract today's sequence as an exported default rendering
      (pure function). Failing test: it returns `set local role "…"`
      followed by one `select set_config($1, $2, true)` per setting in
      declaration order — byte-identical to what is sent today.
- [x] 2.2 (9m) Apply the driver's rendering when it contributes one.
      Failing test: a contributing driver's statements are the first
      statements inside the transaction, in its order, and no default
      statement is sent at all.
- [x] 2.3 (6m) The rendering is a value, not an effect. Failing test: the
      rendering is called with no session in scope and sends nothing; the
      query layer's own send path carries every statement.
- [x] 2.4 (9m) `DbContext.role` becomes optional; a role-less context is
      refused unless the driver declares a role-less platform. Failing
      test: role-less context on an ordinary driver fails before any I/O
      and no transaction opens; on a role-less driver it proceeds and no
      role statement is emitted.
- [x] 2.5 (6m) A named role stays validated everywhere. Failing test: a
      named role outside the four-source union is refused on a role-less
      driver too — the declaration grants no exemption.
- [x] 2.6 (7m) Ordering and serialization survive the generalization.
      Failing test: contributed statements are sent one at a time on the
      one session, in order, before the caller's statement (order mutant,
      not a value mutant).
- [x] 2.7 (7m) The capability gate does not move. Failing test: a driver
      that contributes a rendering and declares interactive transactions
      `false` is still refused a context with the missing-capability
      error, and the rendering is never invoked.
- [x] 2.8 (6m) The capability is still asserted before the resolver.
      Failing test: on a provider handle whose driver lacks the
      capability, the resolver records no call (observable side effect,
      not "an error was thrown").
- [x] 2.9 (5m) `[design]` Error code and message for the role-less
      refusal — whether it joins the `undeclared-role` family or gets its
      own code. Settled by the lead ahead of 2.4 (pre-delivered so 2.4
      wasn't blocked): its own code, `context-role-missing` — never
      `undeclared-role`, whose message lists the declared roles as the
      fix, meaningless when no role was named at all. Confirmed after
      2.10: the throw site (`throwContextRoleMissing`,
      `packages/query/src/db/context.ts`) reads `driver.roleLessPlatform`
      on the merged `DbContext` type, unaffected by the type collapse.
- [x] 2.10 (7m) Collapse the two context types into one. `DbContext`'s
      definition moves to `driver/contract.ts` (the lower layer, where the
      rendering signature needs it) and `db/context.ts` re-exports it;
      the temporary `ContextValue` introduced in 1.1 is removed. Failing
      test: the package exports exactly one context type name, the
      rendering's parameter type and `db.as()`'s argument type are the
      same type (`infer`-extracted comparison, not a whole-object
      compare), and `index.ts`'s public export path for `DbContext` is
      unchanged.

## 3. Context-required enforcement (#556)
Files: `packages/query/src/db/db.ts`,
`packages/query/test/db/context-required.test.ts` (new),
`packages/query/test/db/db.test.ts`

- [x] 3.1 (8m) Uncontexted `execute` is refused. Failing test: a handle
      with no provider on a context-mandatory driver fails with
      `context-required` and nothing reaches the driver.
- [x] 3.2 (7m) Every thenable chain member is refused alike.
- [x] 3.3 (6m) Every declared-function call is refused alike.
- [x] 3.4 (6m) The transaction API is refused alike.
- [x] 3.5 (7m) Non-execution members are unaffected. Failing test: the
      handle's own `driver` member (the schema assertion's path) still
      reaches the database uncontexted.
- [x] 3.6 (6m) A context satisfies the requirement. Failing test: the
      same handle under `db.as(context)`, and a provider handle on the
      same driver, both proceed.
- [x] 3.7 (5m) A driver without the declaration is unchanged. Failing
      test: uncontexted execution on an ordinary driver sends no context
      statement and opens no transaction.
- [x] 3.8 (5m) `[design]` The refusal's code/message and the exact
      surface list (settled leaning: every execution surface;
      `setupSession`/`assertSchema`-class members excluded, reusing the
      "execution surface" wording already in the spec). Confirmed as
      implemented: code `context-required` (`throwContextRequired`,
      `packages/query/src/db/db.ts`), message names the refused
      `operation` and states `Next: call db.as(context) explicitly, or
      register a context provider (db()'s "context" option)`. Surface
      list is exactly the eight the provider survey already named
      (select/insert/update/deleteFrom/with/fn/execute/transaction, all
      reached through the one refusing seam) — `handle.driver` (the
      schema assertion's own path) and `setupSession` (never exposed on
      `Db` at all) are outside it, pinned by 3.5's reverse-evidence test.

## 4. Existing drivers keep their behavior (#557)
Files: `packages/pg/test/driver.test.ts`,
`packages/supabase/test/driver.test.ts`,
`packages/neon/test/driver.test.ts`

- [x] 4.1 (7m) `@hejbro/pg` pin: a context on this driver sends exactly
      today's statements, in today's order. Written and green **before**
      group 2 changes anything.
- [x] 4.2 (7m) `@hejbro/supabase` pin: same, on its pooled-transaction
      path.
- [x] 4.3 (8m) `@hejbro/neon` pin: same on the session path; the HTTP
      path still refuses a context with the missing-capability error —
      the boundary this change must not move.

## 5. Spec, skill, release record (#558)
Files: `openspec/changes/generalize-context-application/**`,
`skills/hejbro/references/query-layer.md`, `.changeset/*.md`,
`openspec/task-times.csv`, `README.md` (task-time badge only)

- [x] 5.1 (8m) `rls-execution-context` delta: modified generic mechanism,
      modified whitelist requirement (role-less is not a bypass), modified
      safety requirement (default rendering vs a contributing driver's own
      obligation), added context-mandatory requirement. *Landed at change
      setup from the approved draft.*
- [x] 5.2 (8m) `driver-contract` delta: the rendering contribution, the
      two declarations, and the requirement that contributing does not
      widen who may run a context. *Landed at change setup from the
      approved draft.*
- [ ] 5.3 (9m) Skill update — `DbContext.role` optional, the two new
      driver declarations, and the sentence that the query layer names no
      platform's statement form. Same PR as the surface change.
- [ ] 5.4 (5m) One `minor` changeset; `openspec/task-times.csv` rows for
      every completed group; README task-time badge refresh
      (`pnpm check:tasktime`).
- [ ] 5.5 (5m) Post-merge rounds are stamped too. Every round after the
      PR merges — the isolated spec-only review (D106), its corrections,
      and the archive move — carries its own `date -u` start/end stamp and
      its own `openspec/task-times.csv` row, written when that round ends
      rather than estimated afterwards. A round whose duration was never
      stamped stays out of the ledger, so the row has to be created while
      the clock is still readable.
- [x] 5.6 (5m) `driver-contract` delta addendum: a driver whose platform
      requires the context to precede every other statement carries its
      own session statements in its rendering (after the context, before
      the caller) rather than in transaction setup. Measured motivation:
      the shipped pooler driver's own pins precede the context statements
      today (group 4's pin records the sequence). Contract text only —
      the implementation belongs to the preset that needs it.

## Verification (definition of done, not a task)
`pnpm check`, `pnpm check-types`, `pnpm test` with `TURBO_FORCE=1` in the
review worktree; `pnpm check:crap`; no file under `packages/core` in the
diff; no platform-specific vocabulary anywhere in `packages/query/src`.
