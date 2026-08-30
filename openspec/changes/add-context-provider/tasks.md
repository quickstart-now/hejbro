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

- [ ] 1.1 (~10m) [design] The option's shape and its construction-time
      check. Settles: the `context` option is a resolver plus a required
      fallback context (proposal's (A) — owner-gated, and the recorded
      flip condition is that the fallback's role cannot be validated at
      construction because the whitelist is not complete where the
      option is read; check this *first*, it decides the task). The
      fallback's role goes through the existing `assertDeclaredRole`
      against `Declarations.roles` at construction. Red:
      `context-provider.test.ts` — "rejects an undeclared fallback role
      when the handle is constructed" and "a handle built without a
      provider issues no context statements".
- [ ] 1.2 (~8m) The resolution primitive: one context-applied
      transaction per execution, built by reusing `applyContext` and
      validating the resolved role before `driver.transaction` is
      called. Red: same file — "applies the resolved role and settings
      before the statement, in one transaction" and "an undeclared
      resolved role reaches the driver as nothing at all, not even
      begin" (asserts the recording driver's statement log is empty —
      `packages/query/test/db/recording-driver.ts`).
- [ ] 1.3 (~8m) Surface coverage: `execute`, every chain member,
      `db.fn.*`, and `transaction` all route through that one
      primitive — the `createAsApi` `scopedRun` shape is the reference
      implementation, not a thing to re-derive per surface. Red: same
      file — "every execution surface runs under the resolved context",
      table-driven over the four surfaces so a surface added later
      without context fails here.
- [ ] 1.4 (~6m) Cadence: the resolver is called once per execution and
      never cached; one `transaction(callback)` resolves once, not per
      statement. Red: same file — "two executions call the resolver
      twice" and "one transaction calls the resolver once".
- [ ] 1.5 (~7m) Precedence and the error path: `db.as(context)` never
      consults the resolver, and a throwing resolver propagates
      unchanged without applying the fallback and without sending
      anything. Red: same file — "an explicit as() never calls the
      resolver" (asserts a call count of 0, not just the applied
      context) and "a throwing resolver sends nothing and does not fall
      back".
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
