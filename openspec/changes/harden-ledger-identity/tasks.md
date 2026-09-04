# Tasks: harden-ledger-identity

One group, one team, sequential — every task touches `packages/cli`'s
apply/ledger area and the shared probe, so there is no file-disjoint
split worth a second group. Every task is test-first (red named below,
minimal green, refactor). Estimates are pure work minutes (D88);
universal claims start from the input table the task names (D110).
Definition of done for every task: `pnpm check`, `pnpm check-types`,
`pnpm test` green with `TURBO_FORCE=1`; the delta scenarios of
`openspec show harden-ledger-identity --diff` hold. Contract details are
settled (`design.md`; rulings 783/R2–R4, 797/R1) — `[design]` below
marks the tasks that carry them into code, not open questions.

## 1. The ledger is judged by identity; the cycle advice covers any length

- [ ] 1.1 (~9m) **[design]** The shared probe. A new module
      `packages/cli/src/apply/ledger-identity.ts` exports
      `probeLedgerIdentity(driver): Promise<LedgerIdentity>` — one
      catalog statement over `pg_class`/`pg_namespace`/`pg_attribute`
      (never `information_schema`, never `to_regclass`), no transaction
      — and the `LedgerIdentity` union `absent | ledger | occupied`
      exactly as `design.md` states (relkind `r` plus the four
      bootstrap columns each with its bootstrap type, superset
      tolerated; the relkind-to-word map). `ledger.ts`'s
      `ledgerTableExists` is removed (its one caller moves in 1.2).
      Red: `packages/cli/test/apply-ledger-identity.test.ts` (new), case
      *"judges what sits at the ledger's name"*, over an input table of
      fake catalog answers: no row (absent); ordinary table with exactly
      the four columns and types (ledger); the four plus `note text`
      (ledger); `id`, `filename` only (occupied, "table", both columns
      named); all four names but `filename integer` (occupied); a table
      `name text, payload jsonb` (occupied); a view with one column
      (occupied, "view"); a view whose four columns match the ledger's
      names and types exactly (occupied, "view" — relkind decides, not
      columns); a materialized view (occupied); a foreign table
      (occupied); a sequence (occupied, "sequence", its own `last_value,
      log_cnt, is_called` listed as found); a partitioned table with the
      four columns in the same order and types (occupied, "partitioned
      table"). Every row's catalog answer is the shape measured on
      `postgres:17-alpine` (relkind letter, `attname`, `format_type`).
      Files: `packages/cli/src/apply/ledger-identity.ts` (new),
      `packages/cli/src/apply/ledger.ts`,
      `packages/cli/test/apply-ledger-identity.test.ts` (new).

- [ ] 1.2 (~9m) **[design]** `reset` refuses on `occupied` before the
      confirmation check, clears on `ledger`, proceeds without clearing
      on `absent`. `assertLedgerNotOccupied(identity, commandName)` in
      `ledger-identity.ts` throws `apply-ledger-occupied` with the
      message `design.md` states; `applyReset` probes right after
      `assertDeclarationsNotEmpty` and before `currentDatabaseName`;
      `ledgerCleared` is true only for `ledger`. Red:
      `packages/cli/test/apply-reset.test.ts`, new describe *"a
      relation that is not the ledger at the ledger's name is refused
      before any confirmation is asked"*, over an input table of what
      the fake driver answers the probe with: a view; a table `name,
      payload` holding rows; a table `id, filename` — each rejects with
      `apply-ledger-occupied` **with `confirmed` undefined** (never
      `reset-not-confirmed`), sends no `current_database()`, no `drop`
      and no `delete from`, and the message names the kind word, the
      columns and a `Next:`; plus three regression rows — absent (with
      confirmation: drops, no delete, `ledgerCleared: false`; without:
      `reset-not-confirmed`), the exact ledger (drops, delete, `true`),
      the ledger with an extra column (same as the exact ledger). The
      existing "refuses without confirmation and sends no DDL" pin
      admits the probe statement beside `current_database()`. The fake
      drivers in `apply-reset.test.ts` and `reset-command.test.ts`
      answer the new probe statement instead of `to_regclass`. Files:
      `packages/cli/src/apply/reset.ts`,
      `packages/cli/src/apply/ledger-identity.ts`,
      `packages/cli/test/apply-reset.test.ts`,
      `packages/cli/test/reset-command.test.ts`.

- [ ] 1.3 (~7m) `status` refuses on `occupied` with the same code.
      `runStatus` probes before `readLedger` and renders the refusal
      through its existing `preconditionResult` path (exit 1); `absent`
      and `ledger` proceed exactly as today. Red:
      `packages/cli/test/status-command.test.ts`, inside the existing
      `runStatus` describe, new case *"a relation that is not the ledger
      is reported as a coded diagnostic, never a raw failure"*: the fake
      importer answers the probe with a view row — assert exit 1,
      `error[apply-ledger-occupied]`, a `Next:` line, no `select
      "filename"` ever sent; a second row where the probe answers ledger
      — today's report byte-for-byte (regression pin). Files:
      `packages/cli/src/commands/status.ts`,
      `packages/cli/test/status-command.test.ts`.

- [ ] 1.4 (~8m) `migrate` refuses on `occupied` before `bootstrapLedger`,
      exit 2. `runMigrate` probes right after
      `assertInteractiveTransactions`; `absent`/`ledger` bootstrap and
      proceed as today. Red: `packages/cli/test/migrate-command.test.ts`,
      new case *"a relation that is not the ledger is refused before the
      bootstrap, and nothing is written into it"*, over an input table:
      a table carrying the ledger's four column names (the worst case —
      the insert would otherwise succeed) and a view — each: exit 2,
      `error[apply-ledger-occupied]`, no `create schema`/`create table`,
      no `insert`, no migration SQL sent; a regression row where the
      probe answers absent — the bootstrap runs and the pending
      migration applies as today. Files:
      `packages/cli/src/commands/migrate.ts`,
      `packages/cli/test/migrate-command.test.ts`.

- [ ] 1.5 (~6m) `raise` refuses on `occupied` before its ledger-history
      read. `applyRaise` probes first; on `occupied` nothing else runs
      (no `readLedger`, no bootstrap, no file statement); `absent` and
      `ledger` proceed as today. Red: `packages/cli/test/apply-raise.test.ts`,
      new case *"a relation that is not the ledger refuses raise before
      anything runs"*: the fake driver answers the probe with a view —
      rejects with `apply-ledger-occupied`, and the only statement ever
      sent is the probe; a regression row where the probe answers absent
      — today's bootstrap-then-apply sequence unchanged. Files:
      `packages/cli/src/apply/raise.ts`,
      `packages/cli/test/apply-raise.test.ts`.

- [ ] 1.6 (~8m) **[design]** `kindHasCycle` detects a cycle of any
      length (797/R1): a recursive peel over the in-set edges — remove
      every identity whose remaining dependencies are all gone; a
      non-empty remainder that removes nothing is a cycle. Self-edges
      stay excluded; `declaredCycleAdvice` says "a set of your declared
      tables that reference each other in a cycle" (the existing `"your
      own declared objects"` assertions move to the new wording where
      they no longer match; `"an object outside your declarations"` and
      the detail-first ordering are untouched). Red:
      `packages/cli/test/apply-reset.test.ts`, new case *"the cycle
      advice fires for a cycle of any length"*, observed the way the
      three existing cycle rows observe it — through `applyReset` with a
      fake driver throwing `2BP01`, asserting the presence or absence of
      the cycle clause (`kindHasCycle`/`dropsContainCycle` stay
      module-private) — over an input table of snapshot shapes: a
      2-cycle (regression pin — advice); a 3-cycle (advice); a 4-cycle
      (advice); a self-referencing table alone (no advice); two
      independent 2-cycles (advice); an acyclic chain a→b→c (no advice);
      a 3-cycle plus one acyclic table hanging off it (advice). The
      fixture: `buildCycleSnapshot` takes the table names to ring
      (`buildCycleSnapshot(["left_t", "right_t"])` reproduces today's
      pair for the three existing callers), with a small separate
      builder for the self-reference and the disjoint/acyclic shapes.
      Files: `packages/cli/src/apply/reset.ts`,
      `packages/cli/test/apply-reset.test.ts`.

- [ ] 1.7 (~10m) Live witness for the identity refusal, in
      `packages/cli/test/apply-reset.integration.test.ts` against the
      same container and gating: (a) declared objects applied with
      `psql` (no ledger ever bootstrapped), then `create table
      hejbro.migration_ledger (name text, payload jsonb)` with three
      rows — `reset` (no confirmation) exits 1 with
      `error[apply-ledger-occupied]` and no `--confirm-drop` token in
      its stderr, both declared tables still stand, the three rows are
      still there; `status` exits 1 with the same code and its stderr
      carries neither `column "origin"` nor a stack frame line;
      `migrate` exits 2 with the same code and the table still holds
      exactly three rows; `raise --file <that chain's own migration>`
      exits 1 with the same code and `to_regclass('hejbro.migration_ledger')`
      still names the same table (no bootstrap); (b) the same four
      commands with `create view hejbro.migration_ledger as select 1 as
      x` — same assertions, the message names "view". Files:
      `packages/cli/test/apply-reset.integration.test.ts`.

- [ ] 1.8 (~6m) Live witness for the any-length cycle: a third schema
      source with `cyc.t_a → cyc.t_b → cyc.t_c → cyc.t_a` (column-level
      `.references(() => …)`, as the existing two-table cycle source
      does), migrated, then `reset --confirm-drop` — exit 1,
      `error[reset-drop-failed]`, `(2BP01)`, the cycle clause present,
      all three tables still standing, `status` afterward still
      reporting the migration applied. Files:
      `packages/cli/test/apply-reset.integration.test.ts`.

- [ ] 1.9 (~6m) `skills/hejbro/references/generate-verify-workflow.md`:
      one paragraph on the identity judgement (what the ledger is, that
      `migrate`/`status`/`reset`/`raise` all refuse with
      `apply-ledger-occupied` when something else holds its name, that
      hejbro never touches the object it finds, that `reset` refuses
      before asking for a confirmation), and the `hejbro reset` section's
      cycle sentence widened from "two declared tables that reference
      each other" to a cycle of any length. `SKILL.md` lists no error
      codes and is untouched. Files:
      `skills/hejbro/references/generate-verify-workflow.md`.

## Close-out (not a group)

`.changeset/harden-ledger-identity.md` (`"hejbro": patch`),
`openspec/task-times.csv` rows, the README stamps (`pnpm
check:tasktime`, `pnpm check:crap`), and the `.blackbox/783|796|797`
work entries land in one close-out commit at PR time.
