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

## Round 2

Context-free adversarial spec review (D106) of `dev` at `5bb26401`
(PRs #775 and #784 merged). Input: `openspec show harden-reset-and-verify
--diff` only — no design/tasks/PR body/git messages/`.blackbox/` were
read (the `show --diff` output itself prints the proposal narrative above
the diffs; it was treated as narrative, never as evidence). Round 1 and
its disposition were read as claims to re-test. Every delta scenario was
driven against a real Postgres 17 (`postgres:17-alpine`, one container
`hejbro-r2-review`, `-c log_statement=all`, removed with `docker rm -v`)
through the built CLI (`packages/cli/dist/cli.js` at `5bb26401`) in
throwaway projects under `/private/tmp/hejbro-r2-*` (deleted
afterwards), reading the statement order `reset` sent from the server
log rather than inferring it from code.

### Verdict

**BLOCKING 0 / NON-BLOCKING 3 / OK 12**

Every delta scenario matches shipped behavior on the inputs its own
sentence names, and on the adversarial inputs this round added (a ledger
table that never existed, an empty ledger, a same-named unrelated ledger,
a view squatting on the ledger's name, an outside dependent, a two- and a
three-table cycle, a self-reference, an alter that adds a foreign key to
a table created in the same run, a refusing/warning/absent preset, a
stale snapshot and a corrupted snapshot under a preset). Round 1's
blocking finding is closed by a live witness. The three non-blocking
findings are all in wording or in a neighbouring command, none in a
delta sentence.

### Blocking

None.

### Non-blocking

**N6 — After a ledger-phase failure, the `Next: run \`hejbro status\``
advice leads into an uncoded crash.** Input: the three migrations applied
with `psql`, then `create schema hejbro; create view
hejbro.migration_ledger as select 1 as id, 'x'::text as filename`, then a
confirmed reset. `reset` itself is right: exit 1,
`error[reset-drop-failed] … failed while clearing the ledger, after its
drops had already run (55000): cannot delete from view "migration_ledger"
(Views that do not select from a single table or view are not
automatically updatable.). The transaction was rolled back …`; afterwards
9 tables and the schema still stand (server log: `ROLLBACK`). But
`hejbro status` — the command that message tells the caller to run —
exits 1 with a raw `error: column "origin" does not exist` and a
node-postgres stack trace: `readLedger` (`packages/cli/src/apply/ledger.ts:246-263`)
tolerates only `42P01`, and `runStatus` (`commands/status.ts:204-213`)
has no coded rendering for any other read failure. Not a delta
contradiction — the delta's status sentence is scoped to a *drop*
failure on a database with a real ledger, and this input has no ledger
at all — but the delta's own `Next:` line now points at a crash for the
one ledger-phase input the message was specifically worded for.
Follow-up in `status` (a coded `apply-ledger-unreadable`-shaped error, or
`readLedger` classifying "exists but is not hejbro's table").

**N7 — The declared-cycle advice recognises a two-table cycle only.**
Input: `cyc3.t_a → t_b → t_c → t_a` (three tables, each referencing the
next). Creation is legal (`create table` ×3, then the three constraints;
`migrate` exit 0). Confirmed reset: the three tables are flushed in
identity order (`runWaves`'s no-ready branch), the server refuses with
`2BP01` and its `DETAIL` names `constraint t_c_a_id_fk on table cyc3.t_c`
(a declared table), the transaction rolls back, `status` still reports
the migration applied — every requirement sentence holds. But the
`Next:` clause reads `resolve what the error above describes (an object
outside your declarations may still depend on one you're dropping)` —
the exact misdirection N3 closed for the pair, because `kindHasCycle`
(`packages/cli/src/apply/reset.ts:200-226`) only tests whether some
dependency of a change names the change back (a direct mutual edge).
The delta sentence says "two declared tables reference each other", so
the text is not contradicted; the advice is. Follow-up: detect any
strongly-connected component (or simply "the refined order still has an
unsatisfied predecessor"), not only a 2-cycle.

**N8 — The wave sort moves unconstrained neighbours, and no sentence
says so.** Step 1 (`lab.p_parent`, `lab.q_child → p_parent`,
`lab.self_ref → self`): identity order is `p_parent, q_child, self_ref`;
the migration created `p_parent, self_ref, q_child` — `self_ref`, which
references nothing in the diff, jumped ahead of `q_child` because
`runWaves` places every currently-unblocked identity before any blocked
one. Same on the drop side (`a_child, chain_a, q_child, self_ref` all
before `b_parent, chain_b, p_parent, z_new`, then `chain_c`). Every
dependency sentence holds, the order is deterministic, and the migration
name follows the pre-refinement order regardless (`add_lab`,
`add_a_child`, `alter_q_child`). But the delta's "whichever order their
identities sort in" and "keeps its existing identity order" (for the
cycle pair only) leave a reader expecting the minimal permutation of
identity order, and `diff-engine.test.ts` ("… without asserting the
independents' own relative order") deliberately declines to pin what
actually happens. Wording/pin follow-up, not a behavioural gap.

### Round 1 re-check

- **B1 — closed.** Live: three migrations applied through `psql` only
  (`to_regclass('hejbro.migration_ledger')` null, 9 tables standing);
  `hejbro status` says `no ledger table exists yet … 3 migration(s)
  pending`; confirmed `reset` exits 0 with `reset: dropped every object
  your declarations manage. There was no hejbro ledger to clear.`;
  afterwards 0 tables/views/sequences, no `lab` schema, no `hejbro`
  schema, no ledger relation (never bootstrapped); `status` again reports
  the same 3 pending. Server log: `select to_regclass(…)` on the
  connection *before* `BEGIN`, no `delete from` inside the transaction,
  `COMMIT` after the last `drop schema`. Code: `ledgerTableExists` read
  at `apply/reset.ts:495` before `driver.transaction`, `clearLedgerRows`
  gated at `:506`, no catch that returns (`throwPhaseTagged` rethrows).
  Tests: `apply-reset.test.ts` B1 block (2), `reset-command.test.ts`
  ledger-claim pair, `apply-reset.integration.test.ts` no-ledger case.
- **N1 — closed.** Both delta texts now say "the same dependency graph …
  read in the opposite direction — never the literal reverse". Live:
  step-2 creation order `b_parent, chain_c, a_child, chain_b, chain_a`;
  reset order for the same tables `a_child, chain_a, …, b_parent,
  chain_b, …, chain_c` — reverse dependency, not a reversed sequence.
- **N2 — closed.** `DETAIL` is appended verbatim in parentheses after the
  reason: `(view lab.outside_view depends on table lab.b_parent)`,
  `(constraint c_right_left_id_fk on table cyc.c_right depends on table
  cyc.c_left)`. `driverErrorDetail` (`apply/execute.ts:250-259`).
- **N3 — partially.** Two-table cycle: `Next:` now reads `the detail
  above names the actual dependent; your own declared objects include a
  pair that reference each other … and an object outside your
  declarations may also still depend on one you're dropping` — the cycle
  fact stated, nothing asserted as the cause. Three-table cycle: the
  old outside-only wording (N7 above).
- **N4 — still open, by design.** `supabasePreset` over a view on an RLS
  table without `securityInvoker` and a policy targeting `public` with
  no schema-usage grant: a *writing* `generate` prints `2 warning(s)`
  (`view-over-rls-without-security-invoker`, `rls-unreachable-schema`);
  `verify` prints `verify: 6 checks passed`. The delta promises refusal
  parity only; #776 is open (`verify: preset validator warnings are
  invisible where generate prints them`).
- **N5 — closed.** `skills/hejbro/references/generate-verify-workflow.md`
  has a `## hejbro reset` section covering reverse dependency order, the
  cycle pair left in identity order, `reset-drop-failed` with rollback /
  ledger / `status` guarantees, and the "There was no hejbro ledger to
  clear" line; the `verify` section counts "up to seven checks";
  `extension-interface.md` lists `dependsOnIdentities` with the
  self-excluded / duplicates-collapsed contract.

### Verified scenarios

- **migration-apply / A referencing table drops before the table it
  references — OK.** `reset_a` (12 declared objects: schema `lab`,
  sequence, 9 tables incl. `a_child → b_parent`, `chain_a → chain_b →
  chain_c`, `q_child → p_parent`, `q_child → z_new`, `self_ref → self`,
  view `b_view`): exit 0, `lab` gone, ledger 0 rows, `status` → 3
  pending. Server order: `drop view; alter table p_parent alter column
  seq drop default; drop sequence; drop table a_child, chain_a, q_child,
  self_ref, b_parent, chain_b, p_parent, z_new, chain_c; drop schema
  lab; delete from migration_ledger; COMMIT` — every dependent before
  what it depends on; the sequence dropped after its default, before its
  table (the delta's statement-level clause). Integration:
  `apply-reset.integration.test.ts` 4/4 (own container, removed).
- **migration-apply / A failed drop leaves the ledger and status telling
  the truth — OK.** Outside view on `lab.b_parent`: exit 1,
  `error[reset-drop-failed] … (2BP01): cannot drop table lab.b_parent
  because other objects depend on it (view lab.outside_view depends on
  table lab.b_parent)`; catalog unchanged (9 tables, 2 views, 1
  sequence, ledger 3 rows); `status` → `3 migration(s) recorded as
  applied … nothing pending`, exit 0. Ledger-phase variant (view
  squatting the ledger name): phase-correct wording, `55000`, rollback
  witnessed — then N6.
- **migration-apply / A reset drops the declared objects on a database
  with no ledger table — OK.** See B1 re-check. A second reset on the
  now-empty database: coded `reset-drop-failed (3F000): schema "lab"
  does not exist`, exit 1 — honest, not a scenario input.
- **migration-apply / two mutually referencing tables drop in identity
  order and the refusal is coded — OK.** `reset_cyc` (`c_left ↔ c_right`,
  `d_both → both`): server order `d_both, c_left, c_right, schema`;
  `2BP01` with `DETAIL`, rollback (3 tables, ledger 1), `status` truthful,
  cycle advice present. Three-table variant: N7.
- **migration-apply / ledger table exists but is empty — OK.** `migrate`
  then `delete from hejbro.migration_ledger`: reset exit 0, `… and
  cleared the ledger.` (the delete did run), 0 tables, 0 rows.
- **migration-apply / an unrelated table sharing the ledger's name and
  columns — OK (observation).** Two hand-inserted rows `status` refuses
  as `apply-ledger-orphan-row`; reset exits 0, drops every declared
  object, deletes both rows, reports `cleared the ledger`. Consistent
  with the requirement's "the ledger SHALL hold no row"; `reset` never
  reads the ledger, so the rows `status` will not interpret are removed
  without a word — same observation as round 1's orphan row, unchanged.
- **cli-commands / A referencing table is created after the table it
  references — OK.** Step 2 (`20260904064340_add_a_child.sql`): `create
  table b_parent` (line 12) before `a_child` (22); `chain_c` before
  `chain_b` before `chain_a`; all three `add constraint … foreign key`
  after the last `create table` (42–46); banner lists the refined order;
  the file is named `add_a_child` (pre-refinement first table). Unit:
  `diff-engine.test.ts` "same-kind dependency ordering" (6 cases),
  `migration-file.test.ts` "the dependency refinement does not change a
  migration's slug".
- **cli-commands / "or altered", and the name sentence — OK.** Step 3:
  `create table z_new` (line 8) before `alter table q_child add column
  z_id` (13) and its FK (15); file named `alter_q_child` (`q` < `z`,
  pre-refinement). Step 1: named `add_lab` (schema kind first).
- **cli-commands / a mutually referencing pair keeps identity order on
  create — OK.** `cyc`: `c_left, c_right, d_both`, FKs deferred,
  `migrate` exit 0 (creation legal).
- **cli-commands / A preset-refused declaration is refused by verify too
  — OK.** `nilePreset` over an RLS table with a `serial` id and a
  tenant table with a lone-`id` key, snapshot matching: `generate` exit
  1 with `nile-rls-unsupported` ×2, `nile-serial-in-tenant-table`,
  `nile-tenant-primary-key-missing`; `verify` exit 1, `diff` of the two
  stderr streams = only `verify: 1 of 6 checks failed` (four refusals,
  one check). Stale declarations under the same preset: `snapshot-stale`
  plus the four, `2 of 6`. Corrupted snapshot: `skipped: preset
  validators (needs a parseable snapshot)`, `1 of 6 … 3 skipped`.
- **cli-commands / A configuration with no preset runs unaffected —
  OK.** No preset: `verify: 5 checks passed`, no `preset` anywhere. A
  preset object carrying `supabasePreset.kinds` and `validators: []`:
  `5 checks passed`, no preset line (`presetsRegistered =
  validators.length > 0`, `verify.ts:898`). `supabasePreset` (validators
  that pass): `6 checks passed`. Unit: `verify.test.ts` sixth-check block
  (7 cases).
- **preset-validation / generate and verify agree on the same refusal —
  OK.** Same evidence as above: identical codes, identical rendered
  blocks, the same `previousSnapshot` (disk) and `configValidators` on
  both paths (`generate.ts:709-732`, `verify.ts:512-519`).
- **`dependsOnIdentities` naming itself, a duplicate, or an identity
  outside the diff — OK.** Code: self filtered at `table-kind.ts:682`
  and again at `diff-engine.ts:218`; duplicates collapsed by `Set`
  (`table-kind.ts:683`, `diff-engine.ts:227`); an identity outside the
  group dropped by `identitySet.has` (`diff-engine.ts:218`). Unit:
  `table-kind-diff.test.ts` "tableKind.dependsOnIdentities" (self → `[]`,
  two FKs to one target → one identity), `diff-engine.test.ts` "ignores a
  foreign key to a table outside this diff's own same-kind change set".
  Live: `self_ref` with two self-FKs created and dropped without
  incident; `q_child → p_parent` (outside step 3's diff) did not
  constrain step 3's order.

### Method

- Read: the delta diff; `packages/cli/src/{commands/reset.ts,
  commands/verify.ts, commands/status.ts (ledger read path),
  apply/reset.ts, apply/ledger.ts, apply/execute.ts, presets.ts}`;
  `packages/core/src/{engine/diff-engine.ts, engine/generate.ts (emit
  order), kind/object-kind.ts, kinds/table-kind.ts (diff,
  dependsOnIdentities), sql/migration-file.ts (deriveSlug /
  preRefinementOrder), engine/preset.ts}`; `packages/pg/src/driver.ts`
  (`transaction`); `skills/hejbro/{SKILL.md,
  references/generate-verify-workflow.md,
  references/extension-interface.md}`; the unit/integration tests named
  above; `gh issue view 776` (state only).
- Live: one `postgres:17-alpine` container (`hejbro-r2-review`,
  `log_statement=all`), databases `reset_a`, `reset_noledger`,
  `reset_empty`, `reset_squat`, `reset_view`, `reset_cyc`, `reset_cyc3`;
  projects `/private/tmp/hejbro-r2-{review,cyc,cyc3,verify}` with
  `node_modules/{hejbro,@hejbro/supabase,@hejbro/nile}` symlinked to the
  workspace packages, mirroring `test/support/cli-runner.ts`.
- Tests run (package-scoped — `pnpm --filter <pkg> test -- <file>` did
  not narrow the run, so each package's whole vitest suite ran; no
  workspace-wide gate, no `build`/`install`/`check-types`):
  `@hejbro/core` 100 files / 1552 passed; `hejbro` unit 91 files / 914
  passed; `hejbro` `test:integration` 13 files / 75 passed
  (`apply-reset.integration.test.ts` 4/4 included; every integration
  container removed).
- Cleanup: `docker rm -v -f hejbro-r2-review`; `/private/tmp/hejbro-r2*`
  removed; no `_r2probe*` file was needed; `git status` shows only this
  file.

## Round 2 disposition

Verdict BLOCKING 0 / NON-BLOCKING 3 / OK 12; round-1 B1, N1, N2, N5 closed
by measurement, N3 closed for the pair and reopened for longer cycles as
N7, N4 stays #776. The change archives on this round.

- **R2-N6** → #796 (`status` crashes with a raw stack when a foreign
  object occupies the ledger's name).
- **R2-N7** → #797 (a cycle longer than two tables gets the
  outside-dependent advice).
- **R2-N8** → #798 (pin where an unconstrained object lands in the wave
  sort).
- Observations without action: an existing-but-empty ledger reports "and
  cleared the ledger" (the delete ran); an unrelated same-named ledger's
  rows are deleted by `reset` without a word (#783 tracks the shape
  check); a second reset on an already-emptied database is a coded
  `reset-drop-failed (3F000)`.
