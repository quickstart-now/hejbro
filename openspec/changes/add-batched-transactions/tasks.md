# Tasks: add-batched-transactions

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands after `add-prepared-statements` archives.

**Files edited**: `packages/query/src/driver/contract.ts`, `packages/
query/src/driver/errors.ts` and their tests (1.1);
`packages/neon/src/http.ts`, `packages/neon/src/driver.ts`, `packages/
pg/src/*.ts`, `packages/supabase/src/driver.ts`, `packages/nile/src/
driver.ts` and the tier-obligation tests (1.2); `packages/query/src/db/
context.ts` and tests (1.3); `packages/query/src/driver/statement-name.ts`
(new), `packages/pg/src/*.ts`, `packages/neon/src/driver.ts` (1.5);
`packages/query/src/driver/result-rows.ts` (new), `packages/pg/src/*.ts`,
`packages/neon/src/driver.ts` (1.6); `skills/hejbro/references/
neon-preset.md`, `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.4).
If a task appears to need any other file, that goes back to the planner,
not into the diff.

**Ordering.** 1.1 → 1.3 → 1.5 → 1.6 → 1.2 → 1.4. 1.2 waits on the
`feat-config-driver` piece (#458), which owns `packages/neon/src/
{http,driver}.ts` until it merges and this branch is rebased.

## 1. Batched transactions

- [ ] 1.1 (~7m) **[design]** The key and the member. Settles the
      `batch` signature and the two-key missing-capability message. Red:
      `packages/query/test/driver/{contract,errors}.test.ts` — a
      declaration omitting `batched-transactions` and one naming a fifth
      key fail `tsc` (type test), `assertCapability(driver,
      ["interactive-transactions", "batched-transactions"])` throws the
      one error naming both. Files: `contract.ts`, `errors.ts`, tests.

- [ ] 1.2 (~10m) The drivers declare and implement. Red: the tier tests
      — an input table over the five shipped drivers {pg, neon ws, neon
      http, supabase over pg, nile over pg} asserting each declaration
      and that `batch` on a `false` driver throws the contract error
      before any statement; the HTTP driver's `batch` sends `[…pins,
      …members]` through `sql.transaction` in order and returns one row
      list per member (recorded `HttpQueryable`); a failing member
      rejects the whole call. Files: the five driver files, tests.

- [ ] 1.3 (~10m) The context runs in a batch. Red: `packages/query/test/
      db/context*.test.ts` — a table over {interactive `true` (unchanged
      statements, `transaction` used), interactive `false` + batched
      `true` (one `batch` call: rendering statements then the caller's,
      last member's rows resolved), both `false` (the two-key error, the
      provider never called), `contextRequired` driver on the batched
      path, `fn` call under context, `as(context).transaction(cb)` on a
      batched-only driver (interactive error, unchanged)} for `execute`,
      the provider handle and `fn`. Files: `context.ts`, tests.

- [ ] 1.4 (~5m) References and changeset. `neon-preset.md`'s two-paths
      section states the HTTP path applies a context in one batch and
      still refuses `transaction(cb)`; `query-layer.md`'s capability
      table gains the key; `pnpm changeset` → `minor`. Files: the two
      references, `.changeset/*.md`.

- [ ] 1.5 (~6m) One statement-name helper (#891). Red: `packages/query/
      test/driver/statement-name.test.ts` — the export yields the two
      drivers' existing goldens for their golden texts, and a grep test
      that neither `packages/pg/src` nor `packages/neon/src` defines a
      `hejbro_` prefix of its own. Files: `statement-name.ts`,
      `contract.ts` (re-export), the two drivers, tests.

- [ ] 1.6 (~7m) **[design]** A multi-command text (#892). Settles the
      rule (last command's rows, psql's own) and its wording. Red: a
      `packages/query/test/driver/result-rows.test.ts` input table over
      the recorded node-postgres shapes {`select 1; select 2`, a DDL then
      a select, a select then a DDL (empty rows), the drivers' own setup
      text, a single-command result} asserting the resolved rows are the
      last command's and never `undefined`, plus the two drivers' own
      tests calling the export, and one row for the handle/`tx.execute`
      path whose `rows.map` raised an uncoded `TypeError` (#892 comment
      2). One function on the driver-contract surface, called by both
      drivers, never a copy per driver (486/R4, the same reasoning as
      1.5). Files: `result-rows.ts` (new), the two drivers, tests.
