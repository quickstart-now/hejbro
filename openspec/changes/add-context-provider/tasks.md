# Tasks: add-context-provider

Three groups, file-disjoint (D88). G1 settles the contract, so G2 and G3
are written against it and run after it — the disjointness is what keeps
them parallel-safe once G1 lands, not a licence to start them early.
Estimates are pure work minutes.

The invariant every task serves: the provider path reaches the database
through the *same* `assertDeclaredRole` and `applyContext` the explicit
path uses. A second validation or application path is this change's own
failure mode — if one appears, stop and escalate rather than route
around it.

## 1. Query-layer context provider

Files: `packages/query/src/db/db.ts`,
`packages/query/src/db/context.ts`, `packages/query/src/index.ts`,
`packages/query/test/db/context-provider.test.ts` (new),
`packages/query/test/exports.test.ts`.

- [ ] 1.1 (~9m) [design] The option and its fail-closed floor. The
      shape is settled by owner decision: `context` is a resolver
      returning a context, non-nullable — no fallback field. What this
      task still settles is the *error shape* for a caller who bypasses
      the type and yields nothing: its code and its message text, which
      are contract. Red: `context-provider.test.ts` — "a handle built
      without a provider issues no context statements" and "a resolver
      yielding nothing fails closed before any statement is sent".
- [ ] 1.2 (~8m) The resolution primitive: one context-applied
      transaction per execution, built by reusing `applyContext` and
      validating the resolved role before `driver.transaction` is
      called. Red: same file — "applies the resolved role and settings
      before the statement, in one transaction" and "an undeclared
      resolved role reaches the driver as nothing at all, not even
      begin" (asserts the recording driver's statement log is empty —
      `packages/query/test/db/recording-driver.ts`).
- [ ] 1.3 (~8m) Surface coverage — **eight** execution entry points,
      measured, not assumed: `select`/`insert`/`update`/`deleteFrom`/
      `with` (the `ChainApi` keys), `execute`, `transaction`, `fn`. The
      scoped handle already routes all eight through the single
      `scopedRun` primitive; the provider path SHALL do the same rather
      than re-derive per surface. Red: same file — "every execution
      surface runs under the resolved context", table-driven over all
      eight so a ninth surface added later without context fails here.
      Confirm `fn.ts`'s own path while here (it was not read during the
      entry-point survey — the survey inferred it from `db.ts`'s call
      shape, so it is the one unverified item).
- [ ] 1.4 (~6m) Cadence: the resolver is called once per execution and
      never cached; one `transaction(callback)` resolves once, not per
      statement. Red: same file — "two executions call the resolver
      twice" and "one transaction calls the resolver once".
- [ ] 1.5 (~7m) Precedence and the error path: `db.as(context)` never
      consults the resolver, and a throwing resolver propagates
      unchanged without sending anything. Red: same file — "an explicit
      as() never calls the resolver" (asserts a call count of 0, not
      just the applied context) and "a throwing resolver sends
      nothing".
- [ ] 1.6 (~9m) Capability ordering — `assertCapability` runs before the
      resolver, so the failure belongs to the driver alone — plus the
      public type on the `@hejbro/query` barrel and its export pin. Red:
      same file — "a missing capability fails before the resolver is
      called" (asserts call count 0); `exports.test.ts` — the provider
      type is exported.

## 2. Supabase adapter and user documentation

Files: `packages/supabase/test/context-provider.test.ts` (new),
`skills/hejbro/references/`.

- [ ] 2.1 (~8m) The adapter is the existing builders and nothing else: a
      provider whose resolver returns `asUser(claims)` and whose
      fallback is `asAnon()` applies through the generic mechanism. Red:
      `packages/supabase/test/context-provider.test.ts` — "a Supabase
      provider applies authenticated and anonymous contexts with no
      preset-side mechanism". **Tripwire**: if this task needs new code
      under `packages/supabase/src/`, the generic shape is wrong — stop
      and escalate, do not add the code.
- [ ] 2.2 (~7m) The skill reference documents the provider surface (a
      changed public surface is a changed user contract, AGENTS.md):
      registration, that an explicit `as()` wins, that the resolver runs
      once per execution uncached, and that a throwing resolver does not
      fall back. Files: `skills/hejbro/references/`.

## 3. Facade re-export and release bookkeeping

Files: `packages/cli/src/index.ts`, `packages/cli/test/exports.test.ts`,
`.changeset/*.md`, `README.md`, `openspec/task-times.csv`.

- [ ] 3.1 (~9m) Re-export the provider type from the `hejbro` facade
      with its export pin, and land the bookkeeping: one `minor`
      changeset (D59, the five published packages are a fixed group),
      README CRAP block (`pnpm check:crap`), task-time rows plus their
      badges (`pnpm check:tasktime`). Red: `packages/cli/test/
      exports.test.ts` — the provider type is re-exported.

## Verification

- `pnpm check`, `pnpm check-types`, `pnpm test` — all with
  `TURBO_FORCE=1` in any isolated worktree (#448).
- `openspec validate add-context-provider --strict`.
- Mutation evidence for the load-bearing claim: with
  `assertDeclaredRole`'s body made a no-op, the provider-path tests go
  red. If they stay green, a second validation path exists.
