# Tasks: harden-ledger-diagnostics

One group. Every task touches `packages/cli`'s apply/ledger area and the
same two new codes, so there is no file-disjoint split worth a second
group; the tasks run in order. Every task is test-first (the red named
below, then minimal green, then refactor). Estimates are pure work
minutes (D88); universal claims start from the input table the task names
(D110). Definition of done for every task: `pnpm check`,
`pnpm check-types`, `pnpm test` green with `TURBO_FORCE=1`; the delta
scenarios of `openspec show harden-ledger-diagnostics --diff` hold.
Contract details are settled (`design.md` D1–D9; lead ruling, recorded as
`.blackbox/836` R1 and `.blackbox/823` R1) — `[design]` below marks the
tasks that carry them into code, not open questions. The two codes are
`apply-ledger-unreadable` and `apply-ledger-unwritable`; a ledger failure
makes `migrate` exit two; the failing statement is identified by the tag
`ledger.ts` attaches where it sends it, never by reading a message back.

## 1. A failure the ledger owns is attributed to the ledger

- [x] 1.1 (~9m) **[design]** Ledger statements carry their own failure.
      `packages/cli/src/apply/ledger.ts` sends every statement through one
      internal wrapper that, on failure, rethrows a tagged access failure
      carrying the server error as `cause`, the direction (`read`/`write`)
      and the site (`bootstrap`, `row`, `recheck`, `clear`, `read`);
      42P01 keeps its existing `{ exists: false }`/`false` leniency
      (D9). No diagnostic text yet — this task only makes the failing
      statement identifiable. Red:
      `packages/cli/test/apply-ledger.test.ts` (the existing unit suite
      for this module — one test file per source module, not a second one
      beside it), case *"a
      failed ledger statement says which statement failed"*, over an input
      table of fake driver failures × entry point, every row carrying the
      server answer measured on `postgres:17-alpine` (batch A2/A3):
      `readLedger` × {`42501 permission denied for table
      migration_ledger` (`select` withheld), `42501 permission denied for
      schema hejbro` (schema `usage` withheld), `42P01 relation
      "hejbro.migration_ledger" does not exist` → `{exists: false}`, not a
      failure — the one answer both a missing table *and* a missing schema
      give, measured, a bare `Error` with no `code`};
      `isMigrationRecorded` × {42501, 42P01 → `false`};
      `bootstrapLedger` × {`42501 permission denied for database <db>` on
      `create schema`, `42501 permission denied for schema hejbro` on
      `create table`}; `recordAppliedMigration` × {`23502` with its
      `DETAIL` and `.column = "id"`, `42501`, `23505`, `23514`, `P0001`};
      `clearLedgerRows` × {42501, 42P01}; plus a success control per entry
      point. (`22001` is not in the table and cannot be: `filename` must
      be `format_type` `text` to pass the identity judgement, and `text`
      carries no length limit — measured.) Files:
      `packages/cli/src/apply/ledger.ts`,
      `packages/cli/test/apply-ledger.test.ts`.

- [x] 1.2 (~10m) **[design]** `apply-ledger-unreadable`, in a new sibling
      module `packages/cli/src/apply/ledger-diagnostics.ts` — the layout
      `ledger-identity.ts` already sets: `ledger.ts` sends statements,
      the sibling owns the refusal's text. It imports
      `driverErrorCode`/`driverErrorReason`/`driverErrorDetail` from
      `execute.ts` (one way only: ledger-diagnostics → execute → ledger;
      `execute.ts` SHALL NOT import this module — 1.4 keeps it a
      rethrower, which is what keeps the graph acyclic and the three
      helpers un-duplicated). The classifier is async and takes the
      driver, because the role read is a statement of its own, and it is
      called from **outside** any failed transaction — a statement sent on
      an aborted transaction is refused (`25P02`), so classifying inside
      the callback would lose the role clause exactly where #823 needs it.
      Starts by folding `apply-ledger-access.test.ts` (created in 1.1)
      into `apply-ledger.test.ts` and deleting it: `ledger.ts`'s tagging
      belongs in that module's own suite, and this task's own cases belong
      in the new module's suite. The tagged read
      failure becomes a `HejbroError` through `hejbroError`, with
      `design.md` D3's text: the qualified ledger name, the role (read
      with `select current_user` on the failure path only, clause omitted
      if that read itself fails — D2), the server's SQLSTATE and message
      unsummarized, and a `Next:` line offering the grant and the
      applying role. The code SHALL originate through `hejbroError` /
      `throwHejbroError`: `check-next-marker` walks only those call sites
      and reads the literal `"Next:"` out of the message argument (or one
      same-file `const` the argument names), so a code built as a bare
      `{ code }` object literal would leave that gate blind.
      Red: `packages/cli/test/apply-ledger-diagnostics.test.ts` (new),
      case *"a ledger read the server
      refuses is a coded diagnostic"*, over the read rows of 1.1's table
      plus one row where `select current_user` also fails: each asserts
      the code, the ledger name, the role clause (present/absent), the
      SQLSTATE, the server message verbatim, one `Next:` line, and that
      the original error survives as `cause`. Files:
      `packages/cli/src/apply/ledger-diagnostics.ts` (new),
      `packages/cli/test/apply-ledger-diagnostics.test.ts` (new),
      `packages/cli/test/apply-ledger.test.ts`,
      `packages/cli/test/apply-ledger-access.test.ts` (deleted).

- [x] 1.3 (~9m) **[design]** `apply-ledger-unwritable`. The tagged write
      failure becomes its own coded diagnostic naming the write site in
      words, with the rollback sentence and D3's one SQLSTATE branch
      (`23502` names the identity/default the bootstrap creates), every
      other code on the generic branch. Red: same test file, case *"a
      ledger write the database refuses names the ledger and what was
      being written"*, over the write rows of 1.1's table: each asserts
      the code, the site words, the server code and message, the `23502`
      branch's own sentence on that row only (its column name taken from
      the driver's own `.column` field, never parsed out of the message —
      plus one row where a `23502` arrives *without* `.column`, added
      during implementation: the branch has two shapes and only the table
      makes both real), and a `Next:` line. Same module and suite as 1.2.
      Files:
      `packages/cli/src/apply/ledger-diagnostics.ts`,
      `packages/cli/test/apply-ledger-diagnostics.test.ts`.

- [x] 1.4 (~8m) **[design]** The half that failed decides the artifact
      (#823). `packages/cli/src/apply/execute.ts`'s catch tests the tag
      before `throwApplyFailure` and **rethrows a tagged failure
      untouched** — it does not classify (that would make it import
      `ledger-diagnostics.ts`, which imports it: the cycle 1.2 exists to
      avoid). Classifying happens one level up, at the caller that holds a
      usable driver after the rollback (1.5, 1.6). The migration's own
      failure is unchanged. Red: `packages/cli/test/apply-execute.test.ts`,
      case *"which half of the transaction failed decides which artifact is
      named"*, input table: the migration statement fails (42601, 42P07,
      55P04) → `apply-failed`/`apply-unsafe-new-enum-value` naming the
      file, as today (regression rows); the ledger row fails (23502,
      42501, 23505) → the tagged write failure escapes with its site and
      its `cause` intact and is **not** `apply-failed`; the
      in-transaction recheck fails (42501) → the tagged read failure
      escapes the same way. Files:
      `packages/cli/src/apply/execute.ts`,
      `packages/cli/test/apply-execute.test.ts`.

- [x] 1.5 (~9m) **[design]** `migrate` reports a ledger failure as its
      own artifact and exits two (D5). `applyFrom`'s failure path passes a
      tagged failure to 1.2/1.3's classifier (the driver is usable again:
      `driver.transaction` has already rolled back by the time this catch
      runs, which is what lets the role read succeed) and renders the
      diagnostic against the ledger, not `failedFileName`; `runMigrate`
      classifies its own bootstrap and `readLedger` failures the same way
      and answers `2`;
      the migrations applied before it keep their stdout buckets. Red:
      `packages/cli/test/migrate-command.test.ts`, case *"a ledger failure
      is not the migration's failure"*, input table: ledger insert refused
      with 23502 on the first pending migration (exit 2,
      `error[apply-ledger-unwritable]`, the header names the ledger, no
      migration file in the header); the same with one migration already
      applied before it (the applied bucket still printed); the ledger
      read refused with 42501 before any apply (exit 2,
      `error[apply-ledger-unreadable]`); a migration's own failure (exit
      1, `apply-failed`, regression row). Files:
      `packages/cli/src/commands/migrate.ts`, the test.

- [x] 1.6 (~8m) `status` and `raise` report a ledger they may not read.
      Each classifies a tagged failure through 1.2/1.3's classifier at the
      one place it touches the ledger, and its existing precondition path
      renders the resulting `HejbroError` unchanged: `status` exits 1 with
      `apply-ledger-unreadable`, `raise` rejects with it before it
      bootstraps anything, and `raise`'s own bootstrap failure takes the
      write code. The task's own completeness check: no ledger statement
      failure escapes either command unclassified. Red:
      `packages/cli/test/status-command.test.ts`, case *"a ledger the role
      may not read is a coded diagnostic, never a raw failure"* (the fake
      importer answers the probe with the ledger and the read with 42501:
      exit 1, the code, a `Next:` line, no stack frame in stderr; a
      regression row where the read succeeds — today's report
      byte-for-byte), and `packages/cli/test/apply-raise.test.ts`, case
      *"a ledger raise may not read refuses before the bootstrap"* (no
      `create schema` and no file statement sent). Files:
      `packages/cli/src/commands/status.ts`,
      `packages/cli/src/apply/raise.ts` (added during implementation:
      `raise`'s four ledger statements live there, not in the thin
      `commands/raise.ts`, which needs no change because `applyRaise` now
      throws only classified errors),
      `packages/cli/test/status-command.test.ts`,
      `packages/cli/test/apply-raise.test.ts`.

- [x] 1.7 (~7m) **[design]** `reset`'s refused clearing names the ledger
      (D6). `applyReset` tells a tagged ledger failure from a drop
      failure, classifies the first through 1.2/1.3's classifier after its
      own transaction has rolled back, and never wraps it in
      `reset-drop-failed`; the drops' own failure path is untouched. Red:
      `packages/cli/test/apply-reset.test.ts`, case *"a refused clearing
      of the ledger is not a refused drop"*, input table: the fake driver
      accepts the drops and refuses `delete from` with 42501 → rejects
      with `apply-ledger-unwritable`, the message names the ledger, and
      neither the cycle advice nor the dependency advice appears; the
      driver refuses a drop with 2BP01 → `reset-drop-failed` unchanged
      (regression row); both succeed → `ledgerCleared: true` (regression
      row). Measured during implementation: the rule reaches **every**
      refusal of the clearing statement, not only `42501` — `ledger.ts`
      tags by statement, never by SQLSTATE, so the `55000` and the `42P01`
      TOCTOU rows that `harden-reset-and-verify` pinned to
      `reset-drop-failed` move to the ledger code too. That is the rule
      working, not a widening of it, and it is now stated in the delta.
      `clearLedgerRows`'s own doc comment (which still names
      `reset-drop-failed` for the race) is corrected in the same task.
      Files: `packages/cli/src/apply/reset.ts`,
      `packages/cli/src/apply/ledger.ts` (comment only), the test.

- [x] 1.8 (~6m) **[design]** The identity probe's own failure takes the
      read code (D8). `probeLedgerIdentity`'s catalog read is wrapped the
      same way, naming the catalog read as what was refused. Red:
      `packages/cli/test/apply-ledger-identity.test.ts`, case *"a refused
      catalog read is a coded diagnostic"*: the fake driver fails the
      probe with 42501 and with a bare `Error` → `apply-ledger-unreadable`
      carrying the server's reason and a `Next:` line, and the four
      commands' existing probe rows still answer as today (regression).
      `probeLedgerIdentity` takes a `commandName` the same way
      `assertLedgerNotOccupied` already does — a diagnostic that names the
      command to rerun cannot be built without it — so its four callers
      move with it. Files: `packages/cli/src/apply/ledger-identity.ts`,
      `packages/cli/src/apply/ledger-diagnostics.ts` (the probe's own
      opening clause), `packages/cli/src/commands/status.ts`,
      `packages/cli/src/commands/migrate.ts`,
      `packages/cli/src/apply/reset.ts`, `packages/cli/src/apply/raise.ts`,
      `packages/cli/test/apply-ledger-identity.test.ts`.

- [x] 1.9 (~10m) Live witness, in
      `packages/cli/test/apply-ledger-diagnostics.integration.test.ts`
      (new). It follows `apply-reset.integration.test.ts` exactly:
      `assertBuiltCli()` then `dockerAvailable()` in `beforeAll` (which
      *throws* rather than skipping — measured), its own
      `docker run -d --name …-${process.pid} postgres:17-alpine`
      (`HEJBRO_PG_IMAGE` honoured) removed in `afterAll`, a 120s
      `beforeAll` and the config's 60s per test. It runs under
      `pnpm --filter hejbro test:integration`, not `pnpm test` — the
      default vitest config excludes `*integration.test.ts` (measured), so
      this task's own gate is that script, and the setup is transcribed
      from `/private/tmp/ld-a2/setup.sh` (batch A/B). Content: (a) hejbro's own ledger with two migrations applied, then a
      role with `connect` but no `select` on it — `status` and
      `raise --file` each exit non-zero with
      `error[apply-ledger-unreadable]`, the stderr carries the role, the
      SQLSTATE and no stack frame line; (a2) the same role running
      `migrate`, whose measured first refusal is its own bootstrap
      (`42501 permission denied for database …` on `create schema`) —
      exit 2 with `error[apply-ledger-unwritable]` naming the bootstrap,
      no stack frame, and the ledger untouched; (b) a
      ledger whose `id` carries neither identity nor default, one pending
      migration — `migrate` exits 2 with
      `error[apply-ledger-unwritable]`, the pending migration's filename
      is absent from the diagnostic header, the object that migration
      declares does not exist afterwards, and the ledger holds the same
      rows it held before. Files: the new integration test.

- [x] 1.10 (~6m) `skills/hejbro/references/generate-verify-workflow.md`:
      one paragraph on the two codes beside the existing
      `apply-ledger-occupied` paragraph — what each means, that hejbro
      never grants or alters anything itself, and that a ledger failure
      means no migration was applied. The reason is AGENTS.md's own
      checklist ("public API surface changed → `skills/hejbro` updated in
      the same PR"): two new error codes are user-facing surface. Neither
      `check:diagnostic-xref` nor `check:next-marker` scans `skills/`
      (measured, batch B1) — they are satisfied by 1.2/1.3 throwing
      through `hejbroError` with a literal `Next:`; this task is the
      contract-to-user half, not a gate remedy. Files:
      `skills/hejbro/references/generate-verify-workflow.md`.

## Close-out (not a group)

`.changeset/harden-ledger-diagnostics.md` (`"hejbro": patch`),
`openspec/task-times.csv` rows, the README stamps (`pnpm check:tasktime`,
`pnpm check:crap`), and the `.blackbox/836|823` work entries land in one
close-out commit at PR time.

## 2. Review repairs (constructor-mode review of 1351d507)

The reviewer built privilege-starved roles and altered ledgers against
`postgres:17-alpine` and ran the built CLI. Four findings are the code
disagreeing with the delta, not the delta needing rework; two more are
text that says something untrue. Every repair keeps the delta as approved.

- [ ] 2.1 (~9m) **[design]** `migrate` reads the ledger before it
      bootstraps one. Measured by the reviewer: against a database whose
      ledger exists but whose read is refused, `status` and `raise` answer
      `apply-ledger-unreadable` while `migrate` answers
      `apply-ledger-unwritable` naming "the ledger's own bootstrap" — a
      statement about a ledger that is already there. The cause is order:
      `commands/migrate.ts` bootstraps and then reads, `apply/raise.ts`
      reads and then bootstraps, and `create … if not exists` checks the
      ACL before it checks existence, so a privilege answer arrives before
      the existence answer. Which code a database gets then depends on
      which grants happen to be missing (the reviewer flipped it by
      granting `create` on the schema). `migrate` takes `raise`'s order:
      read first (`readLedger` already reports an absent table as a
      state), bootstrap only when the read says there is none. Red:
      `packages/cli/test/migrate-command.test.ts`, case *"a ledger that
      exists but cannot be read is not reported as a bootstrap"*, input
      table: ledger present + `select` withheld → exit 2,
      `apply-ledger-unreadable`, no `create schema` sent; ledger present +
      schema `usage` withheld (with `create` granted) → same; ledger
      absent + database `create` withheld → exit 2,
      `apply-ledger-unwritable` naming the bootstrap (unchanged);
      ledger absent and creatable → bootstrap runs exactly once and the
      pending migration applies (regression); ledger present and readable
      → today's report (regression). The integration witness gains the
      first row beside its existing (a2). Files:
      `packages/cli/src/commands/migrate.ts`,
      `packages/cli/test/migrate-command.test.ts`,
      `packages/cli/test/apply-ledger-diagnostics.integration.test.ts`.

- [ ] 2.2 (~9m) **[design]** The in-transaction recheck never swallows a
      vanished ledger. Measured (2 of 2): with the ledger dropped while
      `migrate` holds its transaction, `isMigrationRecorded`'s 42P01
      leniency returns "not recorded", the aborted transaction refuses the
      migration's own statement with `25P02`, and that untagged failure is
      billed to the migration — `apply-failed` naming the file, exit 1.
      Both halves of #823's own rule break at once: the half that failed
      was a ledger read, and exit 1 says the database refused a migration,
      which is exactly what did not happen. The leniency goes: this
      function's one caller runs inside the apply transaction *after* the
      bootstrap, so an absent ledger there is a race, not the "never
      applied to" state `readLedger` reports. `readLedger`'s own leniency
      is untouched — outside a transaction, absence is still a state (D9).
      Red: `packages/cli/test/apply-execute.test.ts`, case *"a ledger that
      vanishes mid-transaction is the ledger's failure"*: the fake driver
      answers the recheck with 42P01 → the tagged read failure escapes
      `applyMigration`, no migration SQL is sent after it, and
      `migrate-command.test.ts` renders it as `apply-ledger-unreadable`
      with exit 2; plus the integration witness for the real race (drop
      the ledger under a held lock, as the reviewer reproduced it). Files:
      `packages/cli/src/apply/ledger.ts`,
      `packages/cli/test/apply-ledger.test.ts`,
      `packages/cli/test/apply-execute.test.ts`,
      `packages/cli/test/migrate-command.test.ts`,
      `packages/cli/test/apply-ledger-diagnostics.integration.test.ts`.

- [ ] 2.3 (~6m) The `23502` hint is about `id` and is said only about
      `id`. Measured: dropping the default from `applied_at` — or from an
      extra `not null` column the identity rule explicitly tolerates —
      produces "The ledger's "applied_at" column has no identity and no
      default; the ledger hejbro bootstraps declares it `bigint generated
      always as identity`", which is false about that column (the
      bootstrap declares `applied_at timestamptz not null default now()`).
      The sentence is D3's one SQLSTATE branch and it exists for #823's
      own measured case, so it is said when the driver's `.column` is
      `id`, and every other column falls to the generic branch that names
      the column without claiming what the bootstrap gave it. Red:
      `packages/cli/test/apply-ledger-diagnostics.test.ts`, input table:
      `23502` on `id` (hint present, regression), on `applied_at` (column
      named, no identity claim), on a tolerated extra `not null` column
      (same), and with no `.column` at all (today's generic sentence,
      regression). Files: `packages/cli/src/apply/ledger-diagnostics.ts`,
      `packages/cli/test/apply-ledger-diagnostics.test.ts`.

- [ ] 2.4 (~6m) One identity for the ledger's own diagnostics. Measured:
      the same code prints two kinds of header —
      `error[apply-ledger-unwritable]: "hejbro"."migration_ledger"` from
      `migrate`, `error[apply-ledger-unreadable]: hejbro status` from the
      others. Both satisfy "the header does not name a migration", but a
      reader (and anything parsing) meets one code with two identities.
      The identity is the artifact that failed, so every ledger diagnostic
      names the ledger, whichever command raised it. Red:
      `packages/cli/test/status-command.test.ts`,
      `packages/cli/test/apply-raise.test.ts`,
      `packages/cli/test/apply-reset.test.ts`: each command's ledger
      diagnostic header is `error[<code>]: "hejbro"."migration_ledger"`,
      while every non-ledger diagnostic each command raises keeps the
      header it has today (regression rows). Files:
      `packages/cli/src/commands/status.ts`,
      `packages/cli/src/apply/raise.ts`, `packages/cli/src/apply/reset.ts`,
      and the three tests.

- [ ] 2.5 (~6m) A raised snapshot file is not called a migration.
      Measured: `raise`'s write refusal says "the row recording
      "…/20260904224853_add_app.sql" … the migration ran in the same
      transaction", but `raise`'s input is a snapshot SQL file, which the
      public surface never calls a migration. The rollback sentence stops
      naming the kind of file and states what actually happened — the
      statements from that file ran in the same transaction and rolled
      back with it — which is true for both callers, so no second wording
      is introduced. The file's own path stays: `raise` takes it from
      `--file` and echoing it back is how a reader knows which one.
      Red: `packages/cli/test/apply-raise.test.ts` (the word "migration"
      is absent from `raise`'s ledger-write message) and
      `packages/cli/test/migrate-command.test.ts` (migrate's own message
      still states the rollback, regression). Files:
      `packages/cli/src/apply/ledger-diagnostics.ts`, the two tests.
