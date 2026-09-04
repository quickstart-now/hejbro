# Evaluation: harden-reset-and-verify

## Round 1

Context-free adversarial spec review (D106) of `dev` at `e22ea237`
(PR #775 merged). Input: `openspec show harden-reset-and-verify --diff`
only — no proposal/design/tasks/PR body/git messages were read. Every
delta scenario was driven against a real Postgres 17 (`postgres:17-alpine`,
one container, removed with `docker rm -v` afterwards) through the built
CLI (`packages/cli/dist/cli.js`, built at `e22ea237`) in throwaway
projects under `/private/tmp` (deleted afterwards), with
`log_statement = 'all'` so the exact statement order `reset` sent could be
read back from the server log rather than inferred from code.

### Verdict

**BLOCKING 1 / NON-BLOCKING 5 / OK 6**

Six delta scenarios; every one matched on the inputs its own sentence
names. The blocking finding is an input the drop-order scenario's `WHEN`
admits (the declared tables standing in their declared schema) for which
its `THEN` ("all three objects are gone afterward and the run exits zero")
is false: the run exits zero and *nothing* is gone.

### Blocking

**B1 — `reset` reports success and exits 0 while dropping nothing when the
ledger table does not exist** (`packages/cli/src/apply/ledger.ts:340-349`,
`packages/cli/src/apply/reset.ts:236-246`, `packages/pg/src/driver.ts`
`transaction`).

- Input: the project's four migrations applied with `psql -f` (no
  `hejbro migrate`, so `hejbro.migration_ledger` never existed — the
  skill's own `generate-verify-workflow.md` names an external pipeline or
  `psql -f` as a valid apply path), then
  `hejbro reset --url … --confirm-drop reset_noledger:12`.
- Observed: stdout `reset: dropped every object your declarations manage,
  and cleared the ledger.`, exit 0. Afterwards `lab` still holds all 5
  tables, the view, the policy, the trigger, the sequence, and the schema
  itself — the catalog is byte-identical to before.
- Server log for that connection: `ERROR: relation
  "hejbro.migration_ledger" does not exist` / `STATEMENT: delete from
  "hejbro"."migration_ledger"` / `LOG: statement: COMMIT`. `clearLedger`
  swallows 42P01 ("a ledger that was never bootstrapped … is a silent
  no-op"), but it runs *inside* `applyReset`'s single transaction with no
  savepoint, so the transaction is already aborted when the callback
  returns; the driver's plain `COMMIT` on an aborted transaction is a
  rollback that Postgres does not report as an error, and every drop
  before it is undone.
- Contradicts: delta scenario *A referencing table drops before the table
  it references* (`THEN … gone afterward and the run exits zero`) and the
  delta paragraph *A drop that fails SHALL leave the database and the
  ledger exactly as they were … and the failure SHALL be reported as a
  hejbro-coded error* — here the failure is reported as success, which is
  worse than the uncoded crash the change set out to close. The
  `reset-drop-failed` path never fires because no drop failed; the ledger
  statement did.
- Note for the lead: the 42P01 leniency in `clearLedger` predates this
  change, so the *cause* is inherited; but the delta text as merged claims
  an outcome this input falsifies, and `reset`'s success line is now
  provably untrue for it. Fix shape is the owner's call (probe
  `to_regclass('hejbro.migration_ledger')` before `BEGIN`; or a savepoint
  around the ledger clear; or let 42P01 surface through
  `throwResetDropFailed`; or bootstrap the ledger the way `migrate` does).
  Not exercised by `apply-reset.test.ts` (no 42P01 row) nor by
  `apply-reset.integration.test.ts` (every case runs `migrate` first).

### Non-blocking

**N1 — "A reset's drops are the reverse of this order" over-claims.**
The generation order for step 2 was `b_parent, chain_c, q_child, a_child,
chain_b, chain_a`; the reset order for the same objects was `a_child,
chain_a, b_parent, chain_b, chain_c`. That is a valid reverse *dependency*
order (every dependent before what it depends on), computed by
`runWaves` independently in the `drop` direction — it is not the reversed
sequence of what generation emitted, which is what "the reverse of this
order" (cli-commands delta) and "This order is the reverse of the one
generation itself emits" (migration-apply delta) say when read literally.
Wording; the property the scenarios actually test (dependents first) holds.

**N2 — `reset-drop-failed` drops the server's `DETAIL`/`HINT`, which is
the line that names what to resolve.** With an outside view on a managed
table, the CLI printed `(2BP01): cannot drop table lab.b_parent because
other objects depend on it`, while the server also sent `DETAIL: view
lab.outside_view depends on table lab.b_parent`. `driverErrorReason`
(`apply/execute.ts:228`) reads `error.message` only, so the one fact the
`Next:` line asks the caller to "resolve" never reaches them. Same shape
as `migrate`'s own failure rendering, so consistent, but the delta's
"carrying the database's own reason" is met only at message level.

**N3 — For a declared cycle, the `Next:` advice misdirects.** Two-table
cycle plus a third referencing both (`d_both` dropped first, then
`c_left`, `c_right` in identity order — exactly the delta's cycle
sentence): the coded error is right (`reset-drop-failed`, 2BP01, nothing
dropped, ledger 1 row, `status` truthful), but its advice says "an object
outside your declarations may still depend on one you're dropping". The
dependent is inside the declarations; the requirement text itself names
this case, the message does not. Follow-up wording.

**N4 — `verify` is silent about warnings `generate` prints for the same
declarations.** `supabasePreset` over a view reading an RLS table without
`securityInvoker`: `generate` exits 0 with `2 warning(s) — see below`
(`view-over-rls-without-security-invoker`, `rls-unreachable-schema`);
`verify` prints `verify: 6 checks passed`. The delta promises identity of
*refusals* only, so this is not a contradiction — but "verify's report is
unaffected" plus "generate and verify agree" invites a reader to expect
the warning block too. Follow-up (either state that warnings are
generate-only, or surface them).

**N5 — `skills/hejbro` documents the new sixth check and
`dependsOnIdentities`, but not `reset`'s new contract.** Neither the drop
order, the `reset-drop-failed` code, nor "a mutual pair is refused by the
database, not resolved" appears anywhere under `skills/hejbro/` (`reset`
has one clause in `SKILL.md` line 21). The extension-interface page is
accurate. The CLI's coded error text is public surface (AGENTS.md: "a
stale skill is a broken user contract").

### Verified scenarios

- **migration-apply / A referencing table drops before the table it
  references — OK (B1 aside).** Live: `lab` with `a_child → b_parent`,
  `chain_a → chain_b → chain_c`, a view/policy/trigger on `b_parent`, a
  `serial` sequence, all under `schema lab`. Statement order sent (server
  log): `drop view b_view; drop policy; drop trigger; alter … drop
  default; drop sequence; disable row level security; drop function;
  drop table a_child; drop table chain_a; drop table b_parent; drop table
  chain_b; drop table chain_c; drop schema lab; delete from
  migration_ledger; COMMIT`. Exit 0; `lab` absent; 0 functions; 0 ledger
  rows; `status` → "4 migration(s) pending". Referencing table sorted
  first (`a_child` < `b_parent`) and dropped first. Also
  `apply-reset.integration.test.ts` (3/3 passed, own container, removed).
- **migration-apply / A failed drop leaves the ledger and status telling
  the truth — OK.** `create view lab.outside_view as select id from
  lab.b_parent` outside the declarations, then confirmed reset: exit 1,
  `error[reset-drop-failed] … (2BP01): cannot drop table lab.b_parent
  because other objects depend on it. The transaction was rolled back …`;
  catalog unchanged (5 tables, 2 views, 1 policy, 1 trigger, sequence),
  ledger 4 rows; `status` → "4 migration(s) recorded as applied … nothing
  pending", exit 0. Error names the first failed object and the server's
  own message (see N2 for `DETAIL`).
- **migration-apply / cycle sentence (requirement text) — OK.** `c_left ↔
  c_right` + `d_both → both`: creation legal (FKs deferred after all three
  `create table`s), drop order `d_both, c_left, c_right`, refused with
  `reset-drop-failed (2BP01)`, nothing dropped, `status` truthful (N3 for
  advice).
- **cli-commands / A referencing table is created after the table it
  references — OK.** Step 2 (`0002_add_b_parent_seq_seq.sql`): `create
  table b_parent` before `create table a_child` although `a_child` sorts
  first; chain created `chain_c, chain_b, chain_a`; `q_child` (FK to
  `p_parent`, outside this diff) stayed in the first wave — an identity
  outside the diff is ignored, as the requirement says. FK constraints
  are still added after every `create table`. Unit:
  `diff-engine.test.ts` "same-kind dependency ordering" (7 cases incl.
  cycle and outside-diff); `table-kind-diff.test.ts`
  `tableKind.dependsOnIdentities` (self-reference → `[]`, two edges to one
  target → one identity). Core targeted suites 103/103.
- **cli-commands / "or altered" and the naming sentence — OK.** Alter-only
  step: file `0003_alter_a_child.sql` (pre-refinement first change), SQL
  `alter table b_parent …` before `alter table a_child …`. Drop-only
  step: file `0004_drop_p_parent.sql`, SQL drops `q_child` before
  `p_parent`. Create+alter mix: file `0005_alter_chain_c.sql`, SQL
  `create table z_new` before `alter table chain_c add column z_id`. The
  banner lists the refined order; the name follows the pre-refinement
  order (`deriveSlug`/`preRefinementOrder`,
  `packages/core/src/sql/migration-file.ts:335-379`;
  `migration-file.test.ts` "the dependency refinement does not change a
  migration's slug").
- **cli-commands / A preset-refused declaration is refused by verify too
  — OK.** `presets: [nilePreset]` over a tenant table with a lone `id`
  primary key plus an RLS table, snapshot already matching: `generate`
  exit 1 with `nile-rls-unsupported` ×2 (rls + policy) and
  `nile-tenant-primary-key-missing`; `verify` exit 1 with the same three
  blocks and `verify: 1 of 6 checks failed` (three refusals, one check —
  count line right). `diff` of the two stderr streams: only verify's
  summary line differs. `supabasePreset` + a declared `auth` schema:
  `reserved-schema` in both, identically (twice each — the same
  identity/text repeated is pre-existing generate behavior, mirrored, not
  a delta concern).
- **cli-commands / A configuration with no preset runs unaffected — OK.**
  No preset: `verify: 5 checks passed` (pre-change count). A preset
  object with `kinds` but `validators: []`: `verify: 5 checks passed`,
  no preset-validator line anywhere (`presetsRegistered =
  validators.length > 0`, `verify.ts:898`). With a registered validator
  that passes: `6 checks passed`. Unit: `verify.test.ts` sixth-check
  block (6 cases); cli targeted suites 63/63.
- **preset-validation / generate and verify agree on the same refusal —
  OK.** Same evidence as above: identical codes and identical rendered
  text for nile (3 refusals) and supabase (`reserved-schema`).

### Method

- Read: the delta diff; `packages/cli/src/{commands/reset.ts,
  commands/verify.ts, apply/reset.ts, apply/ledger.ts, apply/execute.ts,
  presets.ts}`; `packages/core/src/{engine/diff-engine.ts,
  engine/generate.ts, kind/object-kind.ts, kinds/table-kind.ts,
  sql/migration-file.ts, engine/preset.ts}`; `packages/pg/src/driver.ts`
  (`transaction`); `skills/hejbro/{SKILL.md,
  references/extension-interface.md,
  references/generate-verify-workflow.md}`; the unit/integration tests
  named above.
- Live: one `postgres:17-alpine` container (`hejbro-r1-review`,
  `log_statement=all` via `ALTER SYSTEM`), five databases (`reset_a`,
  `reset_cyc`, `reset_noledger`, `reset_badrow`, plus the integration
  test's own container). Projects under `/private/tmp/hejbro-r1*` with
  `node_modules/{hejbro,@hejbro/nile,@hejbro/supabase}` symlinked to the
  workspace packages, mirroring `test/support/cli-runner.ts`.
- Extra adversarial inputs and outcomes: malformed ledger row
  (`zzzz_not_a_real_migration.sql` inserted by hand) — `status` refuses
  with `apply-ledger-orphan-row`; `reset` never reads the ledger, so no
  code surfaces: exit 0, every object dropped, every row (the orphan
  included) deleted — consistent with "the ledger SHALL hold no row".
  No-ledger-table — B1. Outside dependent — N2. Cycle — N3. Warnings —
  N4.
- Tests run: `packages/core` `diff-engine.test.ts`,
  `migration-file.test.ts`, `table-kind-diff.test.ts` (103 passed);
  `packages/cli` `verify.test.ts`, `apply-reset.test.ts`,
  `reset-command.test.ts` (63 passed);
  `apply-reset.integration.test.ts` under
  `vitest.integration.config.ts` (3 passed). No `pnpm build`/`install`,
  no workspace-wide gate.
- Cleanup: `docker rm -v -f hejbro-r1-review`; `/private/tmp/hejbro-r1*`
  removed; `git status` shows only this file.

## Round 1 disposition

- **B1** (blocking — `reset` reported success and dropped nothing when
  the ledger table did not exist) — fixed in task 4.1: `applyReset` reads
  `select to_regclass('hejbro.migration_ledger')` before opening the
  transaction and clears the ledger only when it exists, never inside a
  catch that could swallow the delete's own failure; the success line
  claims "and cleared the ledger" only when it did. Live-witnessed
  against the exact reproduction (migrations applied via `psql -f`, no
  `hejbro.migration_ledger` ever created).
- **N1** (wording — "the reverse of the one generation itself emits"
  over-claimed a literal-sequence reversal) — fixed in task 4.3: both
  spec sides now state the true relationship (the same dependency graph,
  read in the opposite direction).
- **N2** (the coded failure dropped the server's own `DETAIL` line) —
  fixed in task 4.2: `driverErrorDetail` threads it in, verbatim, after
  the reason. Live-witnessed against the outside-dependent scenario.
- **N3** (the `Next:` advice always blamed "an object outside your
  declarations", even for a declared cycle) — fixed in tasks 4.2/C5: a
  pre-transaction check for a same-kind cycle in the run's own drop plan
  adds the cycle fact to the advice without asserting it as the cause —
  the outside-declarations possibility stays in the same message, since
  this module cannot tell which one the server actually refused over
  (the driver names an object, not an edge); N2's own `DETAIL` line is
  what names the real dependent. Live-witnessed against the cycle
  scenario. Reviewer-measured (review round 2, C10): a real Postgres
  `2BP01` always carries a `DETAIL` on the path this tool's own
  dependency-drop failures reach, so the sibling property — the
  detail-pointer clause never appears when there is no detail — has no
  reachable live input and is pinned by a unit case only (the fake
  driver's own thrown error carrying no `.detail`); this is expected,
  not a coverage gap to chase with a live witness.
- **N4** (`verify` is silent about warnings `generate` prints for the
  same declarations) — not a contradiction of this delta (which promises
  refusal parity only, not warning parity); filed as its own follow-up,
  #776.
- **N5** (`skills/hejbro` never documented `reset`'s own contract) —
  fixed in task 4.3: `generate-verify-workflow.md` gained a `hejbro
  reset` section covering drop order, `reset-drop-failed`'s rollback/
  ledger/status guarantee, and the declared-cycle refusal.
