# Tasks: add-apply-engine

**The slicing changed here, and the reason is a rule the group table in
the proposal could not enforce.** That table had eleven groups, one per
command. Written out as files, four of them all edit `src/main.ts` —
the line that registers a command — so they were not parallel-safe.
Command *surface* is now one group that owns every registration, and
each command's *logic* stays in its own file under `src/apply/`. Ten
groups; what moved is which group writes the calling line.

**46 tasks, 398 minutes.** Group 9's three tasks and their 27 minutes
are the sibling change's own, inherited with the work; every other
group's figures are this change's.

Estimates are pure work minutes (D88), frozen. Durations are recorded
clock-stamped (`HH:MM:SSZ-HH:MM:SSZ` in the notes column), because the
ledger's `actual_min` column currently mixes two instruments and the
calibration this change was estimated against — `add-check-schema`, a
1.68 ratio — belongs to the unstamped series.

## 0. Before the first group

- Rebase onto `dev` and confirm the sibling change `add-polyrepo-sync`
  has landed there before group 9 starts. It is expected weeks earlier;
  if the merge order inverts, group 9 cannot start and that is a
  tripwire, not a scheduling detail.
- `pnpm build --force` before any subprocess measurement: this worktree
  carries a `dist` built from `94998be1`, which goes stale the moment
  the branch moves, and a stale `dist` reports on code nobody is
  editing.

## 1. The ledger

Files: `packages/cli/src/apply/ledger.ts`,
`packages/cli/test/apply-ledger.test.ts`.

- [ ] 1.1 (~9m) [design] The table: schema, name, columns, and the key a
      row is found by. Settled here, not discovered: ordering is the
      database's (identity column, server-evaluated timestamp — never a
      value the engine supplies), and the key is the **full migration
      filename**, not its version prefix. `verify`'s own duplicate
      message says why: a tool that tracks applied migrations "by this
      version prefix, not the full filename" can only ever apply one of
      a colliding pair. Red: `apply-ledger.test.ts` — "bootstrap renders
      the ledger table with a server-assigned order".
- [ ] 1.2 (~8m) Bootstrap is idempotent and runs once per apply run, not
      once per file. The inherited requirement said "every migration
      carries it" because no one knew where a chain would be started
      from; an engine knows. Red: same file — "bootstrap applied twice
      leaves one table and no error".
- [ ] 1.3 (~9m) Reading the ledger: which migrations it records, in the
      database's order. A ledger table that does not exist is not an
      error — it is an empty ledger — and that is a distinct state from
      a table that exists and holds no rows, which is what a baseline
      registration produces. Red: same file — "an absent ledger table
      reads as no applied migrations", "an empty ledger table is not
      reported as an absent one".
- [ ] 1.4 (~8m) Writing a row, and registering one without running the
      file (the baseline path). Red: same file — "records an applied
      migration by filename", "registers a baseline without executing
      its statements".

## 2. The plan

Files: `packages/cli/src/apply/plan.ts`,
`packages/cli/test/apply-plan.test.ts`. A pure function: the chain on
disk and the ledger's rows in, an ordered set of pending migrations and
a list of disagreements out. No I/O, so it runs in CI, which has no
database.

- [ ] 2.1 (~9m) Pending set in chain order — the migrations on disk that
      the ledger does not record, ordered by the chain rather than by
      filename. Red: `apply-plan.test.ts` — "orders pending migrations
      by the chain, not by directory listing".
- [ ] 2.2 (~9m) [design] Disagreements, as an enumeration whose members
      each earn their place by having a remedy no other member has: a
      ledger row naming a migration the repository does not have; a
      migration recorded out of order; a gap. Each carries a code and a
      `Next:` line. Red: same file — "reports a ledger row with no file
      on disk", "reports a recorded migration that the chain orders
      after an unrecorded one".
- [ ] 2.3 (~8m) The chain is verified before anything is applied.
      Applying a chain that does not verify is applying bytes nothing
      vouches for, and the check is offline and already written. Red:
      same file — "refuses to plan against a chain whose hashes do not
      verify".

## 3. Execution

Files: `packages/cli/src/apply/execute.ts`,
`packages/cli/test/apply-execute.test.ts`.

- [ ] 3.1 (~9m) [design] One migration is applied as one whole-file
      statement inside `transaction()`, with the ledger row written in
      the same transaction. The [design] part is the shape of the unit:
      the file's text goes out with **no parameters** — measured, a
      single parameter turns the same string into
      `42601 cannot insert multiple commands into a prepared statement`
      — so the ledger insert is its own `execute` inside that
      transaction, where parameters are welcome. Red:
      `apply-execute.test.ts` — "sends the migration as one
      parameterless statement", "writes the ledger row inside the same
      transaction".
- [ ] 3.2 (~9m) A failed migration leaves nothing: no schema change, no
      ledger row. The test has to be able to fail — assert the table the
      first statement created is *absent* afterwards, not merely that an
      error was thrown. Red: same file — "a mid-file failure rolls back
      the statements before it", "a failed migration writes no ledger
      row".
- [ ] 3.3 (~9m) [design] The failure report: which file, the server's
      own code and message, and a `Next:` line. `55P04` gets its own
      translation — a migration that adds an enum value and uses it was
      written before this change's generator existed, and the remedy is
      to regenerate so the enum change lands in its own migration. Red:
      same file — "names the file and repeats the server's code",
      "translates 55P04 into the regenerate remedy".
- [ ] 3.4 (~8m) The advisory lock: `pg_advisory_xact_lock` inside the
      applying transaction, released when it ends. A session-scoped lock
      is the trap here — measured, sequential calls reuse one backend so
      it looks held, and concurrent ones scatter across four, leaving
      the lock owned by a connection the next statement does not get.
      Red: same file — "takes a transaction-scoped lock", "a second
      runner waits rather than applying concurrently".
- [ ] 3.5 (~9m) The precondition the engine states: an applied file
      carries no transaction-control statement **of its own** — the
      detection judges where the word sits, not whether it occurs. A
      `commit` inside a dollar-quoted `plpgsql` body or a string literal
      is not a statement, and refusing such a file would refuse a
      migration this project routinely emits; the same "where does it
      sit" distinction that keeps function bodies out of the split
      trigger applies here. A naive text match is the failure mode to
      guard against, so the red case includes a function body containing
      the word. Why the precondition exists at all: measured, a `commit;`
      mid-file ends the atomicity with no error at all, and a failed
      file containing `begin` poisons the pooled connection so the two
      calls after it fail with `25P02`. Red: same file — "refuses a
      migration containing its own transaction control, naming the
      statement", "accepts a migration whose function body contains the
      word `commit`".

## 4. The generator's split

Files: `packages/core/src/engine/split.ts`,
`packages/core/src/engine/generate.ts`,
`packages/core/test/split.test.ts`,
`packages/cli/src/commands/generate.ts`,
`packages/cli/test/generate-split.test.ts`.

Core stays pure: the split reads the declarations and the snapshot it is
already given. No filesystem, no database, no new runtime dependency, so
the core hard gate does not fire.

- [ ] 4.1 (~10m) [design] The split condition, computed rather than
      listed: does a value this run adds to an enum appear in any
      expression node this run emits, outside a function body? A list of
      surfaces was the alternative and it inherits every slot nobody
      thought of — the specs' own list of expression-bearing slots is
      missing view bodies, which were measured failing. The function-body
      exception is structural: `language` is typed as the literal
      `"plpgsql"`, so the one form whose body is parsed at creation
      cannot be expressed. Red: `split.test.ts` — "splits a run that
      adds an enum value and defaults a column to it", "does not split
      when the value is referenced only inside a function body", "does
      not split when the enum type is created in the same run".
- [ ] 4.2 (~9m) The intermediate snapshot: the previous snapshot with
      the enum entry replaced, hashed like any other. Red: same file —
      "the first file's snapshot hash is the second file's parent hash".
- [ ] 4.3 (~9m) Two emissions from one run, each with its own change set
      so each derives its own slug and its own banner. The final
      snapshot's bytes are identical to what the unsplit run produces —
      measured, and worth pinning, because it is what keeps `verify`'s
      tip check true. Red: same file — "emits two migrations whose
      banners chain", "produces the same final snapshot bytes as an
      unsplit run".
- [ ] 4.4 (~9m) [design] Version separation, as a requirement rather
      than an implementation detail. Two of the three prefix strategies
      derive the version from the clock at one-second resolution, so
      giving the second file `count + 1` fixes only the index strategy —
      measured on all three. Red: `generate-split.test.ts` — "the two
      files have different versions under every prefix strategy".
- [ ] 4.5 (~8m) `--name` with a split. Measured: both files take the
      name, so under the clock strategies their whole paths are one
      string. That the second write would then replace the first, with
      nothing left for `verify` to object to, is deduced rather than
      observed — no split exists yet to watch doing it — so this task's
      red is where the deduction becomes an observation. Assert two
      files exist afterwards, not that one write happened — and guard
      that assertion against passing vacuously: start from an empty
      migrations directory (otherwise an earlier run's files satisfy
      "two exist"), and assert the two **versions differ** (otherwise a
      pair sharing a prefix under the clock strategies is green, which
      is the exact failure this task exists for). Red:
      `generate-split.test.ts` — "a named split writes two files with
      different versions".
- [ ] 4.6 (~8m) The report names both files. It currently prints one
      path and one banner. Red: same file — "reports both migrations
      when a run splits".
- [ ] 4.7 (~8m) [design] What `history` calls the pair. The first file's
      banner names a snapshot never written to disk, so `history` reads
      it as `lost` — a word documented as the trace of a squash merge
      folding intermediate state away. The existing co-add machinery
      absorbs it (the second file is the survivor and `restore` points
      there), so this may cost a sentence rather than a branch; what it
      may not cost is silence, because the diagnostic would then be
      lying about a healthy chain. Red: `generate-split.test.ts` —
      "history explains a split pair without calling it an accident".
- [ ] 4.8 (~7m) The `baseline` report's own strings, which live in this
      same file: they name an external apply tool ("register … in your
      apply tool"), and they advise a two-path `pg_dump` comparison that
      `hejbro check` has since replaced. The function's doc comment
      carries nearly the same sentences as the requirement being
      modified, so the sweep covers the comment too. This sits here
      rather than in group 10 because group 4 owns this file, and two
      groups editing one file is the thing group boundaries exist to
      prevent. Red: `packages/cli/test/generate-command.test.ts` — "the
      baseline report names hejbro's own apply command".
- [ ] 4.9 (~9m) `verify --fix` against a split pair. It renames files to
      resolve duplicate versions, and a rename landing between two
      halves of one run would break the chain they form. Red: same file
      — "verify --fix leaves a split pair's chain intact".

## 5. `reset`

Files: `packages/cli/src/apply/reset.ts`,
`packages/cli/test/apply-reset.test.ts`.

- [ ] 5.1 (~9m) [design] What reset drops: only what hejbro manages.
      `check` already reports unmanaged objects as inventory on the
      stated grounds that a project may legitimately leave them, so a
      reset that dropped them would destroy what this tool says in its
      own specification that it does not own. Red:
      `apply-reset.test.ts` — "drops only declared objects", "leaves an
      unmanaged table standing".
- [ ] 5.2 (~9m) [design] The confirmation it demands and the refusal
      when it is absent, following `generate`'s idiom of confirming a
      destructive change by the dropped object's name. Red: same file —
      "refuses without confirmation, naming what it would drop".
- [ ] 5.3 (~8m) The ledger after a reset: rows for the dropped
      migrations go, and the run that follows re-applies from the start.
      Red: same file — "a reset empties the ledger for what it dropped".

## 6. Raising a database from a snapshot

Files: `packages/cli/src/apply/raise.ts`,
`packages/cli/test/apply-raise.test.ts`.

- [ ] 6.1 (~9m) [design] The input contract: a snapshot SQL file and an
      empty database. Generalized on purpose — that a consumer
      repository's vendored file is the usual source is a convention and
      a config default, not a coupling. Red: `apply-raise.test.ts` —
      "applies a snapshot file to an empty database".
- [ ] 6.2 (~8m) The refusal when the database is not empty. Raising over
      an existing schema is not this command's job and failing halfway
      through someone's data is the worst way to say so. Red: same file
      — "refuses a database that already has declared objects".
- [ ] 6.3 (~8m) What the ledger says about a raised database — the
      baseline-shaped question: the database exists, and no migration
      was applied to make it. Red: same file — "records how the database
      was raised".

## 7. Command surface

Files: `packages/cli/src/main.ts`,
`packages/cli/src/commands/{migrate,status,reset,db-up}.ts`,
`packages/cli/test/{migrate,status,reset,db-up}-command.test.ts`,
`packages/cli/test/help.test.ts`.

`status` and `db-up` are placeholders in this list, not decisions: both
names are settled by 7.1's `[design]`, and the files take whatever it
settles on. A file list is not a place to pre-empt a naming decision by
writing it down first.

This group owns every line that calls the modules above. It exists
because a fully built module that nothing calls passes all its tests and
reports nothing, which reads as agreement.

- [ ] 7.1 (~9m) [design] The command names, and whether status is its
      own command. `history` is taken and means something else — it is
      git-derived, with states `ok`/`lost`/`rewritten`/`uncommitted` —
      so the ledger's report cannot borrow that word. Red: `help.test.ts`
      — "lists the new commands", "does not rename history".
- [ ] 7.2 (~9m) [design] Connection acquisition, shared with `check`
      rather than rebuilt: `--url`, then `DATABASE_URL`, then a coded
      refusal; the driver imported dynamically; a `select 1` probe that
      separates "could not reach" from "could not read" by construction.
      The [design] part is the codes: the existing ones are spelled
      `check-…`, so reused as-is `hejbro migrate` answers with
      `error[check-connection-missing]`. Red:
      `migrate-command.test.ts` — "names the driver package when it is
      missing", "reports an unreachable database in its own words".
- [ ] 7.3 (~8m) The capability this engine requires is stated and
      enforced: `@hejbro/neon`'s HTTP path declares
      `interactive-transactions: false` and its `transaction()` always
      throws, and its endpoint takes one statement per batch member, so
      it can carry neither half of this design. Red: same file —
      "refuses a driver without interactive transactions, naming the
      capability".
- [ ] 7.4 (~9m) [design] `migrate`'s exit codes. `check` set the
      precedent that three answers are distinguishable; an engine's
      third answer is not a checker's, and a lock held by another runner
      is a candidate for one of its own. Red: same file — "exits zero
      with nothing to apply", "exits non-zero when a migration failed",
      "distinguishes a run that could not act".
- [ ] 7.5 (~8m) `migrate`'s report: what it applied, in order, and what
      it did not. A run that applied nothing says so rather than
      printing nothing. Red: same file — "names each migration it
      applied", "says so when there was nothing to apply".
- [ ] 7.6 (~8m) The status command's report: applied, pending, and the
      disagreements group 2 produces. Red: `status-command.test.ts` —
      "reports pending migrations", "reports a ledger row with no file".
- [ ] 7.7 (~7m) `reset` and the raise command reach their modules, with
      their flags and refusals wired. Red: `reset-command.test.ts`,
      `db-up-command.test.ts` — "refuses without confirmation",
      "refuses a non-empty database".

## 8. The live witness

Files: `packages/cli/test/apply-live.integration.test.ts`,
`packages/cli/vitest.integration.config.ts`,
`packages/cli/package.json`.

Runs on the declared floor and on 17. The floor is not decoration: the
example chain was measured failing on 14 at its first file, which is how
the floor was found.

- [ ] 8.1 (~10m) The two-image harness. The comparable change estimated
      its Docker suite at 9 minutes and spent 35, on container-readiness
      rather than on tests — `pg_isready` false-positives during the
      image's bootstrap-then-restart window. Two images doubles that
      exposure. Red: `apply-live.integration.test.ts` — "applies a
      migration against a real server on each supported major".
- [ ] 8.2 (~10m) The whole committed chain applies, on both majors, and
      the test asserts **how many** migrations it applied. A witness
      that only checks for the absence of complaints cannot notice that
      it applied nothing. Red: same file — "applies every migration in
      the example chain", "the ledger holds one row per migration".
- [ ] 8.3 (~10m) Partial failure, produced on purpose: a migration whose
      second statement fails against a real server, asserting the schema
      is unchanged, the ledger is unchanged, and the report names the
      next command. Every claim in the failure contract is unobservable
      otherwise. Red: same file — "a failed migration changes nothing".
- [ ] 8.4 (~10m) Two runners raced, and the enum migration applied for
      the first time against a real server — `alter type … add value` is
      the only statement this project emits that a transaction block
      could refuse, and it appears in no example and no committed
      migration. Red: same file — "a second runner waits for the first",
      "applies a migration that adds an enum value".

## 9. The two-repository witness

File: `packages/cli/test/two-repo.integration.test.ts`.

Inherited from the sibling change, in the three tasks it was written as
— restoring a structure that was folded flat in the handover, not
inventing one. **Every estimate here came frozen from another team's
instrument and has never run**: there is no row for this group in
`openspec/task-times.csv`. They are carried with that written beside
them and corrected from the actuals. The group's own re-freeze history
travels with it: 25m → 27m, when 9.2 absorbed a row-conversion
assertion from elsewhere in that change.

- [ ] 9.1 (~9m) The fixture consumer repository and the vendored SQL it
      receives. Starts only after the sibling change is on `dev`. Red:
      `two-repo.integration.test.ts` — "a consumer repository vendors
      the schema it was given".
- [ ] 9.2 (~10m) The consumer raises its database from that SQL and runs
      a typed query through the emitted contract — the live execution
      the sibling change no longer has anywhere else. This task also
      carries the row conversion absorbed from that change: `numeric`,
      `bigint` and `timestamptz` arriving as the contract's types off a
      **real driver's** wire format, which is the one thing a mocked
      driver cannot establish. Red: same file — "a consumer raises its
      database and queries it through the contract", "numeric, bigint
      and timestamptz arrive as the contract's types".
- [ ] 9.3 (~8m) The freshness diff: the vendored copy against what the
      producer would emit now. Red: same file — "reports a vendored copy
      that has fallen behind".

## 10. Specs, docs and chores

Files: `openspec/specs/cli-commands/spec.md` (Purpose only),
`docs/specs/2026-08-19-hejbro-design.md`, `skills/hejbro/**`,
`.changeset/*.md`, `openspec/task-times.csv`, `README.md`,
`blackbox/2026-09-02-add-apply-engine.md`. No source file under
`packages/` is edited here — the one that was (the `baseline` report's
strings) moved to group 4, which owns that file.

- [ ] 10.1 (~7m) The main spec's `Purpose` for `cli-commands`, edited
      directly. OpenSpec deltas cannot carry a Purpose for an existing
      capability, and this file's Purpose has already gone stale once
      and needed its own change to repair. Files: that spec.
- [ ] 10.2 (~9m) The decision log: D12 amended across all four of its
      places in one edit — index row, log entry, invariant summary,
      out-of-scope list — plus the two new entries (the ledger-reading
      boundary, and the supported-Postgres floor). Numbers are assigned
      by the lead at merge time; a sibling change in flight may claim
      the next one. Files: the design spec.
- [ ] 10.3 (~9m) `skills/hejbro`: rule 7's "the one command that does
      read a live database" is false the moment this ships;
      `generate-verify-workflow.md`'s section on a partway failure keeps
      its first two clauses and loses its conclusion;
      `brownfield-adoption.md` stops calling registration "your
      pipeline's mechanism". `README.md`'s command list is deliberately
      untouched — it is illustrative and already omits commands, so it
      never claimed to be exhaustive. Files: those three.
- [ ] 10.4 (~7m) Changeset (`minor`), task-time rows, README badges.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`.
- [ ] 10.5 (~9m) The `blackbox/` entry (D89). What the owner asked for,
      what was built, and what this change got wrong as plainly as what
      it got right: a premise inherited as measured fact that was
      PostgreSQL 11's rule; a design announced as settled and then found
      to break a migration that works today; a banner marker deferred,
      revived and rejected; and a proposal line claiming core was
      untouched after the ruling that touched it. Files: that entry.

## Verification

- `pnpm check`, `pnpm check-types`, `pnpm test`, `pnpm check:bans`,
  `pnpm check:crap`, `pnpm check:tasktime` — with `TURBO_FORCE=1` in any
  isolated worktree, because the turbo cache is shared across worktrees
  and will otherwise replay another one's logs.
- `pnpm --filter hejbro test:integration` against both supported majors,
  with the executed list and zero skipped shown. Build first: a stale
  `dist` makes the suite report skips that are really a build-freshness
  failure.
- Two gates do not cover what their names suggest and this change lands
  inside both blind spots: `check-next-marker` walks only
  `throwHejbroError`/`hejbroError` call sites, and `check:diagnostic-xref`
  checks that cited codes exist, never that existing codes are cited. The
  engine's codes are covered by a test that fails, not by citing those
  gates.
