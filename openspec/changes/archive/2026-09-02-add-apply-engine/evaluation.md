# D106 adversarial spec-only review — `add-apply-engine` @ 93c2caf9

FAIL: 2 blocking / 7 major / 6 minor

Reviewed in a detached worktree at `/tmp/d106-ae` (93c2caf9, "feat: the apply
engine (migrate, status, reset, raise) (#628)"). Inputs: the three delta specs,
the shipped spec corpus, `skills/hejbro/**`, `packages/*/src` public surfaces,
CLI source, committed example artifacts, `pnpm openspec validate/show`.
Proposal/tasks/design/blackbox/git history were not opened. Line numbers below
are from the worktree at this commit.

---

## B1 (BLOCKING) — The cli-commands driver MODIFIED block names a requirement that does not exist in the shipped corpus

**Delta sentence at issue** — `openspec/changes/add-apply-engine/specs/cli-commands/spec.md:101`:

> `### Requirement: The database driver is an optional dependency`

**Observed.** The shipped `openspec/specs/cli-commands/spec.md` contains no
requirement of that name. Its requirement covering this ground is headed
`### Requirement: An external tool is an optional dependency`
(openspec/specs/cli-commands/spec.md:470), and the shipped corpus references it
by that exact name from another capability
(openspec/specs/schema-vendoring/spec.md:203). The tooling agrees:
`pnpm openspec show add-apply-engine --diff` prints

> `⚠ No matching main requirement found for "The database driver is an optional dependency" in cli-commands`

(`pnpm openspec validate add-apply-engine --strict` nevertheless reports
"valid", so strict validation will not catch this at archive time.)

**Why it is a defect.** A MODIFIED block replaces the shipped requirement it
names. This one names nothing, so at sync/archive it either fails or lands as a
*new* requirement while the shipped "An external tool is an optional
dependency" survives untouched. The corpus would then hold two overlapping
requirements for the same contract: the shipped one still says of `check`'s
no-capability property "that trade is the decision to surface" with no apply
carve-out, while the new one adds "Commands that apply migrations make that
trade openly … the property being protected here is `check`'s, not the CLI's as
a whole" — two truths for one fact, in one file. And if the block was *meant*
to replace the shipped requirement, it silently drops shipped SHALLs and
scenarios (class 2): the git half ("Vendoring runs `git`, and a machine without
it SHALL be told so…", the `history`/`restore` parenthetical), the scenario
"A missing git is explained" (spec.md:509), and the scenario "A connection
failure is distinct from a catalog failure" (spec.md:514) — the delta block
keeps only "A missing driver is explained".

**Repair.** Either retitle the MODIFIED block to `An external tool is an
optional dependency` and carry the full replacement text (git sentences and all
three scenarios retained, apply-trade sentence added), or express the
reorganization as REMOVED + ADDED so the rename is explicit and nothing is
dropped silently.

---

## B2 (BLOCKING) — "A run that finds no difference SHALL write nothing" contradicts the shipped schema-export requirement and the delta's own retained scenarios

**Delta sentence at issue** — cli-commands delta, requirement "Migrations are
generated deterministically from declarations"
(openspec/changes/add-apply-engine/specs/cli-commands/spec.md:144):

> "A run that finds no difference SHALL write nothing, report "no changes —
> snapshot already matches your declarations", and exit zero."

**Observed.**
- The same delta block retains the shipped scenarios "A no-difference run
  still produces a first export" ("**THEN** the export is written anyway",
  delta :207–210) and "A no-difference run refreshes an existing export"
  (delta :212–216).
- The shipped requirement this block replaces says "SHALL write no migration
  and no snapshot" (openspec/specs/cli-commands/spec.md:397–398) and carries a
  whole paragraph the delta silently drops: "Where the export is enabled,
  generation SHALL also write the export described by `schema-export`, from
  the same pass over the declarations, so that a repository cannot hold a
  migration and an export that disagree … **This SHALL hold even when there is
  no difference to write a migration for**" (spec.md:405–413).
- The shipped `schema-export` capability independently requires
  "`generate` SHALL write an **export** into the repository …"
  with scenario "Generating writes the export — WHEN generation runs for a
  repository with the export enabled" (openspec/specs/schema-export/spec.md:17,
  27–32), unconditioned on a diff existing.
- Implemented behavior matches the shipped text, not the delta's: a
  no-difference `generate --export` run writes/refreshes the export
  (verify.ts's export-freshness machinery and the retained scenarios' tests
  depend on it).

**Why it is a defect.** After archive, the corpus would contain a SHALL
sentence ("write nothing") directly contradicted by two scenarios *inside the
same requirement*, by a shipped requirement in `schema-export`, and by shipped,
implemented behavior. This is class 1 (delta text contradicting a shipped
requirement/behavior) plus class 2 (the export SHALL-paragraph is silently
dropped by a MODIFIED block that replaces the whole requirement, orphaning the
"described by `schema-export`" cross-reference the scenarios lean on).

**Repair.** Restore the shipped "write no migration and no snapshot" wording
and the export paragraph (or an updated equivalent) in the MODIFIED block; the
split additions do not require touching either.

---

## M1 (MAJOR) — `status` never reports what the ledger records as applied; the scenario cannot pass as written

**Delta sentences at issue** — migration-apply, "What the ledger holds can be
read without applying anything" (migration-apply/spec.md:184–187):

> "The CLI SHALL provide a `status` command that reports, without changing the
> database: the migrations the ledger records as applied, the migrations on
> disk it does not record, and the disagreements the requirement above
> enumerates."

and its scenario (:195–199):

> "**THEN** it names the two it records and the two it does not"

**Observed.** `status`'s entire success stdout is the pending list:
`renderStatusReport` → `pendingLines` (packages/cli/src/commands/status.ts:65–86)
prints `status: N migration(s) pending:` + pending filenames, or the
caught-up line. No output ever names an applied migration. The command's own
tests pin exactly this (packages/cli/test/status-command.test.ts:27–31: stdout
is only the pending lines). On the disagreement path only the disagreements
are printed (status.ts:89–110) — applied and pending never. The user docs
repeat the spec's claim, not the code's ("`status` reports what the ledger
records", skills/hejbro/SKILL.md:21; skills/hejbro/references/brownfield-adoption.md:17–18).

**Why it is a defect.** A SHALL-listed report member and an explicit scenario
THEN ("names the two it records") have no observable implementation (class 3),
and the skills docs propagate the unimplemented claim to users.

**Repair.** Either `status` gains an applied section (and the test pins it), or
the requirement and scenario are narrowed to what `status` actually reports
(pending + disagreements) — and SKILL.md/brownfield-adoption.md reworded to
match.

## M2 (MAJOR) — "An absent ledger and an empty ledger … SHALL be reported differently" has no reporting surface at all

**Delta sentences at issue** — migration-apply/spec.md:33–37:

> "A ledger table that does not exist and a ledger table that holds no rows are
> different facts and SHALL be reported differently: the first is a database
> hejbro has never applied to, the second is one where hejbro has applied
> nothing yet…"

and the scenario (:50–54): "**THEN** the two are reported as different states,
and neither is reported as the other."

**Observed.** The distinction exists only as the internal `LedgerState` union
(packages/cli/src/apply/ledger.ts:188–190), asserted in unit tests on
`readLedger`'s return value (packages/cli/test/apply-ledger.test.ts:154,162).
Every user-facing path erases it: `planApply` flattens both states to
`applied: []` (packages/cli/src/apply/plan.ts:98–103), so `status` and
`migrate` print byte-identical output for a database with no ledger table and
one with an empty ledger. `LedgerState` is not on the CLI's exported surface
(packages/cli/src/index.ts exports no apply symbol). No command's stdout/stderr
ever renders either state's description.

**Why it is a defect.** The scenario's stated observer ("reported") passes only
vacuously — the "report" is a private function's return shape, which is not a
report in the sense every other use of the word in this corpus carries
(command output). Class 3/4.

**Repair.** Either some command (most naturally `status`) states which of the
two states it found, with a test pinning the two different lines, or the
requirement is rewritten to claim only what is true (the engine distinguishes
the states internally; a registered baseline leaves an empty ledger, not an
absent one) without the word "reported".

## M3 (MAJOR) — The "unverifiable chain" scenario is false on both of its claims as implemented

**Delta sentences at issue** — migration-apply, "Applying refuses a chain that
does not verify…" (:155–158) and its scenario (:166–169):

> "**WHEN** a migration file has been edited by hand and `migrate` runs
> **THEN** it fails naming the artifact whose hash no longer matches, and no
> statement is sent to the database"

**Observed.**
1. *"no statement is sent to the database"*: `runMigrate` orders the work
   connect → `select 1` probe (`withCheckConnection`/`assertConnected`,
   packages/cli/src/check/driver.ts:142,182–196) → capability check →
   `bootstrapLedger` (**two DDL writes**: `create schema if not exists
   "hejbro"`, `create table if not exists "hejbro"."migration_ledger" …`,
   packages/cli/src/apply/ledger.ts:171–179) → `readLedger` → `planApply`,
   where the chain check finally runs (packages/cli/src/commands/migrate.ts:327–341).
   A run refused for an unverifiable chain has already sent four statements,
   two of them writes that persist (the ledger table is created in a database
   the run then refuses to touch).
2. *"a migration file has been edited by hand … fails naming the artifact"*:
   the chain hashes are hashes of the declaration snapshot before/after each
   migration, never of the file's SQL bytes — the delta's own migration-format
   block says exactly this ("the normalized snapshot's hash before and after
   this migration", migration-format delta :7–9), and the implementation states
   the consequence outright: "a file's raw bytes can change in ways that never
   touch its recorded hashes" (packages/cli/src/apply/execute.ts:151–163, the
   comment that justifies the transaction-control precondition's existence).
   `migrate`'s pre-apply check is `checkChain` over banner lines only
   (packages/cli/src/apply/plan.ts:183–189); `migrate` reads no snapshot file
   (config requires only `migrationsDir`, migrate.ts:318), so even the tip
   hash is uncompared. A hand-edit to a migration's SQL body — including the
   very edit the sibling requirement fears, minus the `commit` keyword —
   passes the check and the edited bytes are applied. Only banner-line edits,
   deletions, and reorderings are caught. No test observes a body-edit
   refusal (none exists to observe).

**Why it is a defect.** The THEN asserts two things the surface does not do,
and the WHEN describes a class of edits most of which sail through. It also
contradicts the delta's own migration-format block about what the hashes
vouch for (class 5). The requirement's justification sentence ("applying a
chain whose hashes do not agree is applying bytes nothing vouches for")
inverts the actual guarantee — the chain never vouches for bytes.

**Repair.** Rewrite the scenario to the true contract: WHEN a banner hash-chain
line is edited / a file is removed or reordered, THEN `migrate` refuses before
any *migration* statement is sent (naming the artifacts), and state explicitly
that the chain does not authenticate a file's SQL body (which is why the
transaction-control refusal exists). If ledger bootstrap before the chain check
is intended, say so; otherwise reorder the implementation.

## M4 (MAJOR) — The split rule's "decided from the statements the run is about to emit … it over-approximates" is false for sql-template and raw-sql expressions: the surface under-approximates in the direction the spec calls unacceptable

**Delta sentences at issue** — cli-commands delta, generate requirement
(:151–160, 170–176):

> "it SHALL be decided from the statements the run is about to emit rather
> than from a list of the places such an expression can appear … The test is by
> the value's spelling, and it over-approximates … a missed one costs a
> migration that passes every check hejbro has and fails against the database."

**Observed.** The decision is made over the snapshot's *encoded expression
nodes*, not the emitted statements: `referencesAnyLiteral` matches only
`{nodeKind: "literal", literal: {literalKind: "string", value}}` nodes
(packages/core/src/engine/split.ts:135–148, 188–206; planSplit :226–247). Two
expression encodings that real declarations produce carry their SQL as plain
strings the walk cannot match:
- `sql`-template expressions encode as `chunks` with `chunkKind: "text"`
  carrying raw SQL text — committed example: a check constraint's template
  chunks at examples/postgres/hejbro.snapshot.json:397–412, declared via
  ``check("…", sql`…`)`` (examples/postgres/src/app.schema.ts:129,184,281);
- `sql.raw` encodes as `{nodeKind: "raw-sql", sql: "…"}`
  (packages/core/src/expr/ast.ts:157; committed example:
  examples/supabase/hejbro.snapshot.json:129–131, inside a policy expression —
  a slot the delta explicitly lists as satisfying the condition).

A run that adds a value to an existing enum and also adds/alters a check
constraint, index predicate, or policy whose *sql-template text* spells that
value does not split (the added value never appears as a literal node), emits
one migration, and meets the server's 55P04 at apply time — the exact "kind it
misses" failure the requirement's own rationale exists to rule out. The
over-approximation direction is tested
(packages/core/test/split.test.ts:119); the under-approximation direction has
no test. (End-to-end 55P04 against a live server: UNVERIFIED by execution;
the non-split is structurally certain from the codec shapes above.)

**Why it is a defect.** The SHALL describes a text-of-emitted-statements test;
the surface implements a literal-node test with a hole in a slot the same
requirement enumerates ("a policy's `using` and `with check`", check
constraints, index predicates). "It over-approximates" is asserted where the
implementation demonstrably under-approximates. Class 6.

**Repair.** Either extend the walk to chunk text/raw-sql text (substring match
on the spelling — the requirement's own over-approximation logic already
licenses false positives), or narrow the spec to state the true rule (encoded
literal nodes; values spelled inside `sql` templates and `sql.raw` are not
detected) so the limitation is a stated contract instead of a silent hole.

## M5 (MAJOR) — Deliberate, user-facing surface of the four commands has no owning spec sentence

**Observed** (each item implemented, tested, and absent from every delta and
every shipped requirement):
- `migrate`'s three-way exit code — 0 nothing-pending/applied, 1 a migration
  failed, 2 could-not-act (broken chain, ledger disagreement, missing
  connection/driver/capability) — an explicitly designed contract
  (packages/cli/src/commands/migrate.ts:53–69, planFailureResult :269–290).
  Compare: `check`'s exit trichotomy is spelled out in its shipped requirement
  (openspec/specs/cli-commands/spec.md:147–155). `reset`/`raise` exit shapes
  are likewise unowned.
- The connection surface of all four commands: `--url` flag, `DATABASE_URL`
  fallback (migrate.ts:27–32; status.ts:20–25; reset.ts:27–37; raise.ts:20–29).
  The shipped corpus pins this for `check` only (spec.md:116–119, including
  the "SHALL NOT be read from hejbro.config.ts" security sentence — nothing
  extends that protection to the new commands).
- `raise --file` (required; refusal code `raise-file-missing`,
  packages/cli/src/commands/raise.ts:65–73).
- `reset --confirm-drop` and its token shape `<database>:<count>` bound to
  `current_database()` (packages/cli/src/apply/reset.ts:59–81) — the delta
  says only "confirmed explicitly".
- The ledger's identity — schema `hejbro`, table `migration_ledger`, columns
  id/filename/applied_at (ledger.ts:136–138,177) — a permanent object hejbro
  creates in every user database; the delta says only "a table hejbro
  creates".
- `migrate`'s four report buckets (applied / registered baseline /
  already-applied-by-another-run / already-registered, migrate.ts:74–145) and
  the nothing-to-apply line (:71).

**Why it is a defect.** Class 3: implemented user-facing behavior — flags,
exit codes, output shapes, a durable database object — with no owning spec
sentence, in a corpus whose existing requirements pin exactly these kinds of
detail for the older commands (baseline's `--help` surface, `generate`'s
flags, `check`'s exit codes and URL sourcing).

**Repair.** Add the sentences: migrate's exit trichotomy, the shared
`--url`/`DATABASE_URL` (+ not-from-config) rule for connecting commands,
`raise --file`, reset's confirmation token shape, and the ledger's qualified
name (or an explicit statement that the name is not contract).

## M6 (MAJOR) — "Reset SHALL refuse unless the destruction is confirmed explicitly" — but a zero-drop reset proceeds unconfirmed and still destroys ledger rows

**Delta sentence at issue** — migration-apply/spec.md:239–240:

> "Reset SHALL refuse unless the destruction is confirmed explicitly, and the
> refusal SHALL name what would be dropped."

**Observed.** `assertResetConfirmed` returns immediately when the computed
change list is empty (packages/cli/src/apply/reset.ts:69–71: "Nothing to drop
needs no confirmation"), after which `applyReset` still runs `clearLedger` —
`delete from "hejbro"."migration_ledger"`, every row, unconditionally
(reset.ts:156–162; ledger.ts:292–301). The change list is computed from the
*current declarations* (planReset, reset.ts:25–29). So a `hejbro reset` run in
a project whose declarations load but export nothing (a wrong entry point —
the exact misconfiguration `check` and `baseline` refuse with dedicated coded
errors, openspec/specs/cli-commands/spec.md:162–166 and :29–33) drops nothing,
asks for nothing, exits 0 — and silently empties the ledger of a database
whose applied migrations are all still standing. The next `migrate` then
re-applies the chain from the beginning against objects that still exist. No
empty-declaration guard exists on `reset`, and no spec sentence owns the
unconfirmed ledger wipe.

**Why it is a defect.** The SHALL is unconditional; the surface has an
unconfirmed destructive path. It also cuts against the corpus's own
empty-declaration-set precedent (`check`'s "zero declared objects … is never
a real pass" reasoning applies at least as strongly to a destructive command).

**Repair.** Either the spec gains the zero-change carve-out *and* the
ledger-clear is moved under the confirmation (or an empty-declaration refusal
mirroring `check`'s), or the implementation refuses an empty declaration set
before touching anything.

## M7 (MAJOR) — The ledger row `raise` writes is, by the same delta's own definition, a permanent "orphan row" disagreement that blocks `migrate` and fails `status`

**Delta sentences at issue** — migration-apply/spec.md:270–271:

> "The ledger SHALL record how the database was raised, so a database created
> this way is not mistaken for one no migration has ever reached."

versus :171–175 (and :201–205 for `status`):

> "**WHEN** the ledger records a migration the repository does not contain
> **THEN** it is reported with its own code and a `Next:` line…"

**Observed.** `raise` records the `--file` value verbatim as an ordinary
ledger row (packages/cli/src/apply/raise.ts:133–139,150; raise.ts command
:88–95) — deliberately not chain-shaped, per the implementation's own comment,
as the *only* signal of how the database was raised. `planApply` classifies
every applied row absent from the chain as `apply-ledger-orphan-row`
(packages/cli/src/apply/plan.ts:199–209). Consequence: in any repository with
a migration chain (the delta itself insists "The file's origin is not part of
the contract", so raising from an authoring repo's own export is in-contract),
`hejbro status` against a raised database exits 1 with
`apply-ledger-orphan-row`, and `hejbro migrate` refuses (exit 2) with a
`Next:` line telling the user to "resolve the mismatch by hand — hejbro will
not guess". One requirement mandates creating exactly the state a sibling
requirement mandates reporting as a blocking disagreement; nothing in the
delta reconciles them. (Consumer repositories dodge it only incidentally,
because `migrate`/`status` demand `migrationsDir` config they don't have —
also nowhere stated.) UNVERIFIED by live run; the classification path is
code-certain.

**Why it is a defect.** Internal contradiction between two ADDED requirements
(class 5) with a real user-facing dead end.

**Repair.** Spec how a raise row is distinguished from an orphan (a marker the
plan recognizes, or an explicit statement that raised databases are outside
`migrate`/`status`'s domain and why), and make the implementation match.

---

## m1 (MINOR) — "refused … before any statement is sent" is literally false: a `select 1` probe is sent first

Delta migration-apply :137–140 ("**THEN** it fails with a coded error naming
the capability, before any statement is sent"). `assertInteractiveTransactions`
runs inside `withCheckConnection`'s callback, after `assertConnected`'s
`select 1` probe (check/driver.ts:142,182–196; migrate.ts:327–332). The intent
("no DDL, no transaction") is met; the sentence as written is not. Repair:
"before any migration statement is sent".

## m2 (MINOR) — The shipped cli-commands Purpose already claims coverage of the four commands, whose requirements live in migration-apply

openspec/specs/cli-commands/spec.md:5–13 ("Covers … `migrate` … `status` …
`reset` … `raise`") at this commit, while the corpus holds no cli-commands
requirement for any of them (they are the delta's ADDED `migration-apply`
capability, still unarchived). A reader of the shipped file is promised
contracts it does not contain — and the corpus's Purpose was evidently touched
ahead of archive. Repair: point the Purpose at `migration-apply` for the four
commands (or move their CLI-surface sentences into cli-commands at archive).

## m3 (MINOR) — "the format-version line" misnames what the banner carries

Both the shipped and the MODIFIED migration-format requirement call the
`-- hejbro: ` line "the format-version line". The line records the generating
tool's package version, not a file-format version (parseBannerVersion doc:
"the exact hejbro version a migration was generated with",
packages/core/src/sql/migration-file.ts:255–272; prefix at :184). The MODIFIED
block rewrote this requirement and kept the misnomer. Repair: "the
hejbro-version line" (or introduce a real format-version line).

## m4 (MINOR) — `raise`'s "refuse … before applying anything / applies nothing" holds only net-of-rollback, and the refused database keeps hejbro's ledger table

Delta :266–268, scenario :279–282. For a colliding database with no ledger
rows, `applyRaise` sends the whole snapshot file inside the transaction and
translates the server's class-42 failure afterwards (apply/raise.ts:70–117,
141–154) — refusal by attempted apply + rollback, not "before applying
anything". And `bootstrapLedger` runs *before* the emptiness check
(raise.ts:146–148), so a refused database permanently gains
`hejbro.migration_ledger`. Post-state is empty of the file's objects, so the
scenario is observably satisfiable, but the requirement's "before" and the
scenario's "applies nothing" both overstate. Repair: state the two-layer
mechanism (precheck by ledger; in-transaction refusal otherwise, rolled back)
and the ledger-table side effect.

## m5 (MINOR) — Reset's two SHALLs conflict when declarations have drifted from applied history

"returns a database to the state before any migration was applied" and "SHALL
drop only objects the declarations describe" (:232–234) are jointly
unachievable when an applied object is no longer declared: reset drops only
the currently-declared set (planReset over the current snapshot,
apply/reset.ts:25–29) yet clears the whole ledger — the survivor object then
collides with the re-applied chain. No sentence chooses which SHALL wins.
Repair: scope the first sentence ("…insofar as the declarations still
describe what was applied") or spec the drift case.

## m6 (MINOR) — "a convention and a configuration default" — no configuration default exists for `raise`

Delta :262–264 says the snapshot file's arrival is "a convention and a
configuration default", but `raise` reads no config at all and `--file` is
required with no fallback (`raise-file-missing`, raise.ts:65–73, 105–107).
Repair: drop "and a configuration default" or add the default.

---

## Checked and clean (considered, verified, rejected as findings)

- **Atomic apply + ledger row in one transaction; parameterless migration
  text; parameterized ledger insert as its own statement** — implemented
  exactly as specified (execute.ts:344–365; ledger.ts:265–274).
- **Transaction-control refusal** — coded (`apply-transaction-control`), names
  statement and file, quote/dollar-quote/line-comment aware, refuses before
  any send (execute.ts:93–188). The block-comment false-refusal direction is
  the safe one and the spec doesn't forbid it.
- **Transaction-scoped advisory lock; no session lock** —
  `pg_advisory_xact_lock` inside the apply transaction (execute.ts:26–41).
  "A second runner waits … neither run fails" — per-migration lock + in-lock
  ledger recheck (`isMigrationRecorded`) makes the waited runner apply only
  what is unrecorded at lock time; the already-applied buckets are reported.
- **Capability refusal exists and names the capability**
  (`apply-missing-capability`, capability.ts:35–46); `status` requires no
  capability and its test proves no transaction and no writes
  (status-command.test.ts:159–195). Matches shipped driver-contract's
  two-capability set and its missing-capability requirement.
- **Baseline registered, not run; marker read via exported parser** —
  `parseBannerBaseline` by prefix only (migration-file.ts:286–287), used by
  `readBaselineFileNames` (verify.ts:302–311); `applyMigration` skips the DDL
  send for baseline files inside the same lock/transaction; live witness
  exists (apply-live.integration.test.ts §12).
- **Both ledger-disagreement kinds carry distinct codes and Next lines**
  (`apply-ledger-orphan-row` / `apply-ledger-out-of-order`, plan.ts:89–114);
  `status` reports the same codes and exits non-zero (status tests pin the
  code identity with `migrate`). The tasks-era third kind ("a gap") is
  correctly the second kind, as the ledger comment argues.
- **Failure report names file + DB code/message passed through + Next line**;
  55P04 translated to the regenerate story (`apply-unsafe-new-enum-value`,
  execute.ts:261–284).
- **Chain-order application, never directory order** — directory order is
  *verified* to be chain order (`checkChain`) before use; a mismatch refuses
  rather than re-sorts (plan.ts:183–198). Satisfies the sentence.
- **Bootstrap idempotent, once per run; ordering from a DB-assigned identity
  column; rows keyed by full filename** (ledger.ts:171–179; migrate.ts:333).
- **Reset drops only declared objects by construction** (diff of declared
  snapshot → empty, apply/reset.ts:25–29 — an undeclared object cannot appear
  in the diff); refusal names every would-be-dropped object; ledger cleared so
  the chain re-applies from the start; the ledger table itself is spared.
- **Baseline delta block (cli-commands)** — all seven shipped scenarios
  retained verbatim, one added; the new report sentences are implemented
  verbatim (`Next: run \`hejbro migrate\` to register … then run \`hejbro
  check\` …`, generate.ts:605).
- **migration-format MODIFIED** — all four shipped scenarios retained; the
  rewritten hash-lines description ("normalized snapshot's hash before and
  after") now *matches* the implementation (BannerHashes; parent-snapshot/
  snapshot prefixes) where the shipped text ("this migration's own content
  hash") did not — a correction, not a regression. Prefix-only parsing,
  unknown-line tolerance, and prose-not-contract all hold
  (migration-file.ts:180–287). Public parsers exported
  (core index.ts:398–400).
- **Split scenarios** — enum+default splits into two migrations with distinct
  versions under all three prefix strategies (generate-split.test.ts:144–160),
  banners chain, `--name` does not collapse the pair (:162–180); function-body
  and new-enum exclusions implemented and tested (split.test.ts:59–117);
  determinism gains "same number of migration files".
- **`raise` on an empty database** — applies the file, records it; ledger
  precheck collapses absent/empty deliberately (both are legal targets — a
  *different* question from M2's reporting).
- **Skills docs cover all four commands** (SKILL.md:21;
  brownfield-adoption.md; generate-verify-workflow.md's per-migration
  transaction description matches the delta — "not one transaction over the
  whole run").
- **`openspec validate add-apply-engine --strict`**: passes ("Change
  'add-apply-engine' is valid") — noted under B1 that this gate does not
  catch the dangling MODIFIED.
- **apply-* code-prefix family vs `check-*`** — no shipped-spec conflict; the
  shipped cli-commands `check` codes and messages are untouched.
- **`verify` shipped requirement's own "hand-edited migration … reported as a
  mismatch" overclaim for body-only edits** — pre-existing shipped-spec
  looseness, out of this change's scope; noted here only because M3 imports
  the same overclaim into new delta text.
