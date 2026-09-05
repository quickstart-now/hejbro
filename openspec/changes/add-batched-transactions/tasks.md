# Tasks: add-batched-transactions

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). Lands after `add-prepared-statements` archives.

**Files edited**: `packages/query/src/driver/contract.ts`, `packages/
query/src/driver/errors.ts` and their tests (1.1);
`packages/pg/src/driver.ts`, `packages/supabase/src/pooler.ts` and the
tier-obligation tests, plus the compile-forced fake-`Driver` literals
under `packages/{cli,supabase,nile}/test/**` (1.2a); `packages/neon/src/
http.ts`, `packages/neon/src/driver.ts`, `packages/neon/test/**` (1.2b);
`packages/query/src/db/
context.ts` and tests (1.3); `packages/query/src/driver/statement-name.ts`
(new), `packages/pg/src/*.ts`, `packages/neon/src/driver.ts` (1.5);
`packages/query/src/driver/result-rows.ts` (new), `packages/pg/src/*.ts`,
`packages/neon/src/driver.ts` (1.6); `skills/hejbro/references/
neon-preset.md`, `skills/hejbro/references/query-layer.md`, one
`.changeset/*.md` (1.4).
If a task appears to need any other file, that goes back to the planner,
not into the diff.

**Ordering.** 1.1 → 1.2a → 1.3 → 1.5 → 1.6 → 1.2b → 1.4 (486/R5). 1.2a
lands before 1.5; 1.2b waits on the `feat-config-driver` piece (#458),
which owns `packages/neon/src/{http,driver}.ts` until it merges and this
branch is rebased. Splitting 1.2 is an external file-ownership boundary,
not a work-size decision: a required `batch` member breaks every driver
value at once, so leaving all five to the end would keep the whole
repository red through 1.3, 1.5 and 1.6 and a real regression would
arrive invisible behind the known failures. After 1.2a the red is
isolated to `@hejbro/neon` alone.

## 1. Batched transactions

- [ ] 1.1 (~7m) **[design]** The key and the member. Settles the
      `batch` signature and the two-key missing-capability message. Red:
      `packages/query/test/driver/{contract,errors}.test.ts` — a
      declaration omitting `batched-transactions` and one naming a fifth
      key fail `tsc` (type test), `assertCapability(driver,
      ["interactive-transactions", "batched-transactions"])` throws the
      one error naming both. Files: `contract.ts`, `errors.ts`, tests.

- [ ] 1.2a (~5m) The session-path drivers declare (486/R5). Red: the
      tier table's first three rows — {pg, supabase over pg, nile over
      pg} — asserting each declaration reads `batched-transactions:
      false` and that `batch` on such a driver throws the contract error
      before any statement reaches the database. Both decorators spread
      a complete `Driver`, and 486/R7 splits them on that: Nile owns no
      execution path, so its row is two lines — over pg the declaration
      reads `false` and `batch` throws, and over a fake base declaring
      `true` both the declaration and `batch` are inherited whole (the
      mechanism, pinned) — and its `src` changes not at all. The
      Supabase pooler builds its own capability record, so it declares
      `false` *and* overrides `batch` with the throwing stub: an
      inherited `batch` under a `false` declaration is exactly the hole
      "A capability explicitly declared false fails closed" forbids, so
      its row includes "over a `true` base, still `false`, still
      throws". Files: `packages/pg/src/driver.ts`,
      `packages/supabase/src/pooler.ts`, their tests, and the fake
      `Driver` literals a required `batch` member breaks across
      `packages/{cli,supabase,nile}/test/**` (compile-forced and
      mechanical; admitted here by 486/R8 because the sweep is the
      fourth key's direct consequence — split out, it would be a task
      with no red of its own).

- [ ] 1.2b (~6m) The one-shot driver implements (486/R5). Runs after the
      `feat-config-driver` piece (#458) merges and this branch is
      rebased; until then `packages/neon` belongs to that piece. Red:
      the tier table's remaining two rows — {neon ws, neon http} — plus
      the HTTP driver's own `batch` sending `[…pins, …members]` through
      `sql.transaction` in order and returning one row list per member
      (recorded `HttpQueryable`, offline and deterministic); a failing
      member rejects the whole call. Files: `packages/neon/src/http.ts`,
      `packages/neon/src/driver.ts`, `packages/neon/test/**` (the test
      sweep admitted by 486/R8, same reasoning as 1.2a's).

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
