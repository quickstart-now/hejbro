# Tasks: add-apply-engine

**The slicing changed here, and the reason is a rule the group table in
the proposal could not enforce.** That table had eleven groups, one per
command. Written out as files, four of them all edit `src/main.ts` —
the line that registers a command — so they were not parallel-safe.
Command *surface* is now one group that owns every registration, and
each command's *logic* stays in its own file under `src/apply/`. Ten
groups; what moved is which group writes the calling line.

**Groups 1–13, as merged: 58 tasks, 492 minutes** — file-derived at
close-out. (The D106 correction round is groups 14–20 and counts
separately: 22 tasks, 167 minutes. **The scope is stated so this
sentence can stop going stale** — it has twice, and both times the
number moved while the sentence did not.) The original freeze read
"46 tasks, 398 minutes" over ten groups: 7.5 was
re-frozen 8→10 by the group-4 commit when it took ownership of the
run-level property, and groups 11–13 were added mid-flight, each with
its reason on its own header. (4.3r's ~9m entered in the same commit
as the completed rework — an estimate-shaped number that was never a
prediction, which is why the ledger keeps that row's est empty.)
Group 9's three tasks and their 27 minutes are the sibling change's
own, inherited with the work; every other group's figures are this
change's.

Estimates are pure work minutes (D88), frozen. Durations are recorded
clock-stamped (`HH:MM:SSZ-HH:MM:SSZ` in the notes column), because the
ledger's `actual_min` column currently mixes two instruments and the
calibration this change was estimated against — `add-check-schema`, a
1.68 ratio — belongs to the unstamped series.

## 0. Before the first group

- Group 9 cannot start until the sibling change `add-polyrepo-sync` is
  on `dev`. It landed there while this change was in group 7, so the
  precondition is met — and the way to pick it up is **`git merge
  upstream/dev`, never a rebase**: this branch is pushed, and rebasing
  rewrites history other people have already fetched. The merge commit
  shows up in the PR's commit list and is squashed away at merge, so it
  costs a line in the PR body and nothing else. Do it **after group 8
  lands and before group 9 starts** — not while a live witness is
  running, which would move the tree under a suite that takes minutes —
  and run every gate once afterwards, so a cross-change regression
  surfaces before group 9 builds on top of it. "Every gate" MUST
  include `openspec validate --strict` by name — it is not in
  `ci.yml`, and this change ran the merge-in gates without it: the
  sibling's new scenarios had landed inside a requirement this
  change's delta MODIFIES, and a MODIFIED block replaces the whole
  requirement, so archiving would have dropped them silently
  (repaired at close-out, `3b7af63d`). Archive-stage gates live
  outside `ci.yml`; a gate list derived from `ci.yml` alone is
  complete only for CI.
- `pnpm build --force` before any subprocess measurement: this worktree
  carries a `dist` built from `94998be1`, which goes stale the moment
  the branch moves, and a stale `dist` reports on code nobody is
  editing.

## 1. The ledger

Files: `packages/cli/src/apply/ledger.ts`,
`packages/cli/test/apply-ledger.test.ts`.

- [x] 1.1 (~9m) [design] The table: schema, name, columns, and the key a
      row is found by. Settled here, not discovered: ordering is the
      database's (identity column, server-evaluated timestamp — never a
      value the engine supplies), and the key is the **full migration
      filename**, not its version prefix. `verify`'s own duplicate
      message says why: a tool that tracks applied migrations "by this
      version prefix, not the full filename" can only ever apply one of
      a colliding pair. Red: `apply-ledger.test.ts` — "bootstrap renders
      the ledger table with a server-assigned order".
- [x] 1.2 (~8m) Bootstrap is idempotent and runs once per apply run, not
      once per file. The inherited requirement said "every migration
      carries it" because no one knew where a chain would be started
      from; an engine knows. Red: same file — "the bootstrap statements
      are written to be idempotent". The name says what a test without a
      server can establish: that two applications leave one table is
      Postgres's `if not exists` semantics, and group 8's live witness
      is where that is shown.
- [x] 1.3 (~9m) Reading the ledger: which migrations it records, in the
      database's order. A ledger table that does not exist is not an
      error — it is an empty ledger — and that is a distinct state from
      a table that exists and holds no rows, which is what a baseline
      registration produces. Red: same file — "an absent ledger table
      reads as no applied migrations", "an empty ledger table is not
      reported as an absent one".
- [x] 1.4 (~8m) Writing a row, and registering one without running the
      file (the baseline path). Red: same file — "records an applied
      migration by filename", "registers a baseline without executing
      its statements".

## 2. The plan

Files: `packages/cli/src/apply/plan.ts`,
`packages/cli/test/apply-plan.test.ts`. A pure function: the chain on
disk and the ledger's rows in, an ordered set of pending migrations and
a list of disagreements out. No I/O, so it runs in CI, which has no
database.

- [x] 2.1 (~9m) Pending set in chain order — the migrations on disk that
      the ledger does not record, ordered by the chain rather than by
      filename. Red: `apply-plan.test.ts` — "orders pending migrations
      by the chain, not by directory listing".
- [x] 2.2 (~9m) [design] Disagreements, as an enumeration whose members
      each earn their place by having a remedy no other member has: a
      ledger row naming a migration the repository does not have, and a
      migration recorded out of order. Each carries a code and a
      `Next:` line. A third member was listed here — "a gap" — and it is
      not one: a ledger holding 0001 and 0003 but not 0002 *is* a
      recorded migration the chain orders after an unrecorded one, the
      same state under a second name. The delta spec enumerates two, and
      the two are the members. Red: same file — "reports a ledger row
      with no file on disk", "reports a recorded migration that the
      chain orders after an unrecorded one".
- [x] 2.3 (~8m) The chain is verified before anything is applied.
      Applying a chain that does not verify is applying bytes nothing
      vouches for, and the check is offline and already written. Red:
      same file — "refuses to plan against a chain whose hashes do not
      verify".

## 3. Execution

Files: `packages/cli/src/apply/execute.ts`,
`packages/cli/test/apply-execute.test.ts`.

- [x] 3.1 (~9m) [design] One migration is applied as one whole-file
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
- [x] 3.2 (~9m) A failed migration leaves nothing: no schema change, no
      ledger row. The test has to be able to fail — assert the table the
      first statement created is *absent* afterwards, not merely that an
      error was thrown. Red: same file — "a mid-file failure rolls back
      the statements before it", "a failed migration writes no ledger
      row".
- [x] 3.3 (~9m) [design] The failure report: which file, the server's
      own code and message, and a `Next:` line. `55P04` gets its own
      translation — a migration that adds an enum value and uses it was
      written before this change's generator existed, and the remedy is
      to regenerate so the enum change lands in its own migration. Red:
      same file — "names the file and repeats the server's code",
      "translates 55P04 into the regenerate remedy".
- [x] 3.4 (~8m) The advisory lock: `pg_advisory_xact_lock` inside the
      applying transaction, released when it ends. A session-scoped lock
      is the trap here — measured, sequential calls reuse one backend so
      it looks held, and concurrent ones scatter across four, leaving
      the lock owned by a connection the next statement does not get.
      Red: same file — "takes a transaction-scoped lock", "a second
      runner waits rather than applying concurrently".
- [x] 3.5 (~9m) The precondition the engine states: an applied file
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
`packages/cli/test/generate-split.test.ts`,
`packages/cli/src/history-table.ts`, `packages/cli/src/history-state.ts`
and their tests — added to this group because 4.7's repair lands there
and no other group owns those files. Also
`packages/cli/test/restore-command.test.ts` and
`packages/cli/test/baseline-command.test.ts`: both pin, as strings,
messages this group rewrites. Whoever changes a user-facing string owns
the tests that hold it — and those tests are invisible to the compiler
and to every gate, so the group that finds them is the group that
changed the string.

Core stays pure: the split reads the declarations and the snapshot it is
already given. No filesystem, no database, no new runtime dependency, so
the core hard gate does not fire.

- [x] 4.1 (~10m) [design] The split condition, computed rather than
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
- [x] 4.2 (~9m) The intermediate snapshot: the previous snapshot with
      the enum entry replaced, hashed like any other. Red: same file —
      "the first file's snapshot hash is the second file's parent hash".
- [x] 4.3r (~9m) Where the run is assembled, revised after the group
      first landed. The split was built with the CLI calling core's
      pieces, which put four internal symbols on the package's public
      index; the ruling was to move the assembly into core so none of
      them needed exporting. Then a count changed the ruling: more than
      forty files across the preset and driver packages and the examples
      read `generateMigration`'s result fields directly, so reshaping
      that result was not a contained edit, and adding an array beside
      the old fields would have served a split run's first half to every
      existing caller as the whole run. So core gains **one** entry
      point that returns a run's migrations, the old one keeps its
      contract for runs it can express and refuses — coded, naming the
      new one — the runs it cannot, and the four internals come back off
      the index. Red: `split.test.ts` — "the single-migration entry
      point refuses a run that must split, naming the entry point that
      can".
- [x] 4.3 (~9m) Two emissions from one run, each with its own change set
      so each derives its own slug and its own banner. The final
      snapshot's bytes are identical to what the unsplit run produces —
      measured, and worth pinning, because it is what keeps `verify`'s
      tip check true. Red: same file — "emits two migrations whose
      banners chain", "produces the same final snapshot bytes as an
      unsplit run".
- [x] 4.4 (~9m) [design] Version separation, as a requirement rather
      than an implementation detail. Two of the three prefix strategies
      derive the version from the clock at one-second resolution, so
      giving the second file `count + 1` fixes only the index strategy —
      measured on all three. Red: `generate-split.test.ts` — "the two
      files have different versions under every prefix strategy".
- [x] 4.5 (~8m) `--name` with a split. Measured: both files take the
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
- [x] 4.6 (~8m) The report names both files. It currently prints one
      path and one banner. Red: same file — "reports both migrations
      when a run splits".
- [x] 4.7 (~8m) [design] What `history` calls the pair. The first file's
      banner names a snapshot never written to disk, so `history` reads
      it as `lost` — a word documented as the trace of a squash merge
      folding intermediate state away. The existing co-add machinery
      absorbs it (the second file is the survivor and `restore` points
      there), so this may cost a sentence rather than a branch; what it
      may not cost is silence, because the diagnostic would then be
      lying about a healthy chain. Red: `generate-split.test.ts` —
      "history explains a split pair without calling it an accident".
- [x] 4.8 (~7m) The `baseline` report's own strings, which live in this
      same file: they name an external apply tool ("register … in your
      apply tool"), and they advise a two-path `pg_dump` comparison that
      `hejbro check` has since replaced. The function's doc comment
      carries nearly the same sentences as the requirement being
      modified, so the sweep covers the comment too. This sits here
      rather than in group 10 because group 4 owns this file, and two
      groups editing one file is the thing group boundaries exist to
      prevent. Red: `packages/cli/test/generate-command.test.ts` — "the
      baseline report names hejbro's own apply command".
- [x] 4.9 (~9m) `verify --fix` against a split pair. It renames files to
      resolve duplicate versions, and a rename landing between two
      halves of one run would break the chain they form. Red: same file
      — "verify --fix leaves a split pair's chain intact".

## 5. `reset`

Files: `packages/cli/src/apply/reset.ts`,
`packages/cli/test/apply-reset.test.ts`, and `apply/ledger.ts` with its
test — group 1's files, reopened here because clearing the ledger has no
home anywhere else and the groups run one at a time.

Reset empties the ledger's rows and leaves its table standing: the table
lives in hejbro's own schema and no declaration describes it, so the
same requirement that stops reset from dropping a user's unmanaged table
stops it from dropping this one.

- [x] 5.1 (~9m) [design] What reset drops: only what hejbro manages.
      `check` already reports unmanaged objects as inventory on the
      stated grounds that a project may legitimately leave them, so a
      reset that dropped them would destroy what this tool says in its
      own specification that it does not own. Red:
      `apply-reset.test.ts` — "drops only declared objects", "leaves an
      unmanaged table standing".
- [x] 5.2 (~9m) [design] The confirmation it demands and the refusal
      when it is absent. This task's first draft said to follow
      `generate`'s idiom of confirming by the dropped object's name;
      measurement narrowed that — `generate`'s drop confirmation exists
      for rename-versus-drop ambiguity, not for destruction in general,
      and naming every object is impractical here. What carries over is
      the principle, not the flag: the user types something they could
      not have typed by reflex, and the refusal names what would be
      dropped and exactly what to type. One confirmation is enough; the
      enumerating is the refusal's job. Red: same file — "refuses
      without confirmation, naming what it would drop".
- [x] 5.3 (~8m) The ledger after a reset: rows for the dropped
      migrations go, and the run that follows re-applies from the start.
      Red: same file — "a reset empties the ledger for what it dropped".

## 6. Raising a database from a snapshot

Files: `packages/cli/src/apply/raise.ts`,
`packages/cli/test/apply-raise.test.ts`, and `apply/execute.ts` with its
test — group 3's, reopened here because raising reuses the apply path
and that path names `migrate` in its failure advice. A second caller is
what turned a hardcoded command name into a defect; the fix is to take
it as a required argument, not a defaulted one, so a new caller is asked
what to advise rather than inheriting the wrong answer. The names
themselves stay unwritten here — 7.1 settles them, and a name written
down early is a string pin waiting to break.

- [x] 6.1 (~9m) [design] The input contract: a snapshot SQL file and an
      empty database. Generalized on purpose — that a consumer
      repository's vendored file is the usual source is a convention and
      a config default, not a coupling. Red: `apply-raise.test.ts` —
      "applies a snapshot file to an empty database".
- [x] 6.2 (~8m) **Two layers, and a third case that is not a gap.**
      The ledger answers cheaply for a database hejbro has applied to;
      it cannot answer for one holding objects with no ledger, because
      nothing here reads the catalog. The transaction covers that: the
      run is one transaction, so an object the snapshot would recreate
      collides, nothing is left behind, and the server's "already
      exists" is translated into this command's own words. Both layers
      are tested, the second with a **colliding** object.
      An object that does *not* collide — a table of someone else's that
      this snapshot never creates — passes, and that is the contract
      rather than a hole in it: the requirement refuses a database that
      holds *declared* objects, and an object no declaration describes
      is one this product elsewhere reports as inventory and leaves
      alone. Do not add a catalog scan to chase it; that would read the
      shape of a database to decide, which is the thing this change does
      not do. The refusal when the database is not empty. Raising over
      an existing schema is not this command's job and failing halfway
      through someone's data is the worst way to say so. Red: same file
      — "refuses a database that already has declared objects".
- [x] 6.3 (~8m) What the ledger says about a raised database — the
      baseline-shaped question: the database exists, and no migration
      was applied to make it. Red: same file — "records how the database
      was raised".

## 7. Command surface

Files: `packages/cli/src/main.ts`,
`packages/cli/src/commands/{migrate,status,reset,raise}.ts`,
`packages/cli/test/{migrate,status,reset,raise}-command.test.ts`,
`packages/cli/test/help.test.ts`.

Those names were placeholders while 7.1 was open; 7.1 settled them as
`status` and `raise`, and the list now carries the decision rather than
a guess. `raise` is the word the delta spec already uses for the
operation, so the command and the contract say the same thing.

This group owns every line that calls the modules above. It exists
because a fully built module that nothing calls passes all its tests and
reports nothing, which reads as agreement.

- [x] 7.1 (~9m) [design] The command names, and whether status is its
      own command. `history` is taken and means something else — it is
      git-derived, with states `ok`/`lost`/`rewritten`/`uncommitted` —
      so the ledger's report cannot borrow that word. Red: `help.test.ts`
      — "lists the new commands", "does not rename history".
- [x] 7.2 (~9m) [design] Connection acquisition, shared with `check`
      rather than rebuilt: `--url`, then `DATABASE_URL`, then a coded
      refusal; the driver imported dynamically; a `select 1` probe that
      separates "could not reach" from "could not read" by construction.
      The [design] part is the codes: the existing ones are spelled
      `check-…`, so reused as-is `hejbro migrate` answers with
      `error[check-connection-missing]`. The problem runs both ways and
      is settled here once, across every code this change touches:
      the apply path minted `migrate-…` codes that raising a database
      now raises too, so that command answers with a code named after a
      different one. Decide the prefixes for the whole set rather than
      per command as each meets the problem. Red:
      `migrate-command.test.ts` — "names the driver package when it is
      missing", "reports an unreachable database in its own words".
- [x] 7.3 (~8m) The capability this engine requires is stated and
      enforced: `@hejbro/neon`'s HTTP path declares
      `interactive-transactions: false` and its `transaction()` always
      throws, and its endpoint takes one statement per batch member, so
      it can carry neither half of this design. Red: same file —
      "refuses a driver without interactive transactions, naming the
      capability".
- [x] 7.4 (~9m) [design] `migrate`'s exit codes. `check` set the
      precedent that three answers are distinguishable; an engine's
      third answer is not a checker's, and a lock held by another runner
      is a candidate for one of its own. Red: same file — "exits zero
      with nothing to apply", "exits non-zero when a migration failed",
      "distinguishes a run that could not act".
- [x] 7.5 (~10m) `migrate`'s report: what it applied, in order, and what
      it did not. A run that applied nothing says so rather than
      printing nothing. **This task also owns the run-level behaviour**:
      the engine applies one migration, so "a run stops at the first
      failing migration, leaving the ones before it applied and
      recorded" is a property of the loop that lives here and of no
      other task — the delta scenario had no owner until group 3 scoped
      execution to a single migration and the gap became visible. Red:
      same file — "names each migration it applied", "says so when there
      was nothing to apply", "stops at the first failing migration and
      keeps the ones before it".
- [x] 7.6 (~8m) The status command's report: applied, pending, and the
      disagreements group 2 produces. Red: `status-command.test.ts` —
      "reports pending migrations", "reports a ledger row with no file".
- [x] 7.7 (~7m) `reset` and the raise command reach their modules, with
      their flags and refusals wired. Red: `reset-command.test.ts`,
      `raise-command.test.ts` — "refuses without confirmation",
      "refuses a non-empty database".

## 8. The live witness

Files: `packages/cli/test/apply-live.integration.test.ts`,
`packages/cli/vitest.integration.config.ts`,
`packages/cli/package.json`.

Runs on the declared floor and on 17. The floor is not decoration: the
example chain was measured failing on 14 at its first file, which is how
the floor was found.

- [x] 8.1 (~10m) The two-image harness. The comparable change estimated
      its Docker suite at 9 minutes and spent 35, on container-readiness
      rather than on tests — `pg_isready` false-positives during the
      image's bootstrap-then-restart window. Two images doubles that
      exposure. Red: `apply-live.integration.test.ts` — "applies a
      migration against a real server on each supported major".
- [x] 8.2 (~10m) The whole committed chain applies, on both majors, and
      the test asserts **how many** migrations it applied. A witness
      that only checks for the absence of complaints cannot notice that
      it applied nothing. Red: same file — "applies every migration in
      the example chain", "the ledger holds one row per migration".
- [x] 8.3 (~10m) Partial failure, produced on purpose: a migration whose
      second statement fails against a real server, asserting the schema
      is unchanged, the ledger is unchanged, and the report names the
      next command. Every claim in the failure contract is unobservable
      otherwise. Red: same file — "a failed migration changes nothing".
- [x] 8.4 (~10m) Two runners raced, and the enum migration applied for
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

- [x] 9.1 (~9m) The fixture consumer repository and the vendored SQL it
      receives. Starts only after `upstream/dev` has been merged in —
      this branch forked before the sibling change landed, so the
      vendoring machinery it needs is not here until then. Red:
      `two-repo.integration.test.ts` — "a consumer repository vendors
      the schema it was given".
- [x] 9.2 (~10m) The consumer raises its database from that SQL and runs
      a typed query through the emitted contract — the live execution
      the sibling change no longer has anywhere else. This task also
      carries the row conversion absorbed from that change: `numeric`,
      `bigint` and `timestamptz` arriving as the contract's types off a
      **real driver's** wire format, which is the one thing a mocked
      driver cannot establish. Red: same file — "a consumer raises its
      database and queries it through the contract", "numeric, bigint
      and timestamptz arrive as the contract's types".
- [x] 9.3 (~8m) The freshness diff: the vendored copy against what the
      producer would emit now. Red: same file — "reports a vendored copy
      that has fallen behind".

## 10. Specs, docs and chores

Files: `openspec/specs/cli-commands/spec.md` (Purpose only),
`docs/specs/2026-08-19-hejbro-design.md`, `skills/hejbro/**`,
`.changeset/*.md`, `openspec/task-times.csv`, `README.md`,
`blackbox/2026-09-02-add-apply-engine.md`. No source file under
`packages/` is edited here — the one that was (the `baseline` report's
strings) moved to group 4, which owns that file.

- [x] 10.1 (~7m) The main spec's `Purpose` for `cli-commands`, edited
      directly. OpenSpec deltas cannot carry a Purpose for an existing
      capability, and this file's Purpose has already gone stale once
      and needed its own change to repair. Files: that spec.
- [x] 10.2 (~9m) The decision log: D12 amended across all four of its
      places in one edit — index row, log entry, invariant summary,
      out-of-scope list — plus the two new entries (the ledger-reading
      boundary, and the supported-Postgres floor). Numbers are assigned
      by the lead at merge time; a sibling change in flight may claim
      the next one. Files: the design spec.
- [x] 10.3 (~9m) `skills/hejbro`: rule 7's "the one command that does
      read a live database" is false the moment this ships;
      `generate-verify-workflow.md`'s section on a partway failure keeps
      its first two clauses and loses its conclusion;
      `brownfield-adoption.md` stops calling registration "your
      pipeline's mechanism". Two more, both from the split: `generate`
      writes **two** migrations where Postgres's transaction semantics
      require a boundary, which is user-facing behaviour the skill has
      to state; and `@hejbro/core` gains one exported entry point that
      returns a run's migrations, which the skill documents because a
      public surface this change adds and the skill does not describe is
      a broken user contract rather than a docs nit. `README.md`'s
      command list is deliberately untouched — it is illustrative and
      already omits commands, so it never claimed to be exhaustive.
      Files: those three skill files.
- [x] 10.4 (~7m) The changeset — `minor`, a new capability; the seven
      published packages move together, so naming one is enough. **The
      task-time rows and the README badges are not here**: both ledgers
      are written once, by the lead, at PR close-out. One writer is what
      keeps two piece branches from colliding on the same file, and a
      row added per group would drag a README regeneration along with
      it — a gate that fails on one CI leg long after the change looks
      green locally.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`.
- [x] 10.5 (~9m) The `blackbox/` entry (D89). What the owner asked for,
      what was built, and what this change got wrong as plainly as what
      it got right: a premise inherited as measured fact that was
      PostgreSQL 11's rule; a design announced as settled and then found
      to break a migration that works today; a banner marker deferred,
      revived and rejected; and a proposal line claiming core was
      untouched after the ruling that touched it. Files: that entry.

## 11. The concurrent-runner repair

Found by group 8's witness, after every group above had landed. It
crosses three slices — `apply/execute.ts` (group 3), the `migrate`
report (group 7), and the live witness (group 8) — because a defect
found by running the whole thing does not respect a boundary drawn over
files. Reopening those three is recorded here rather than pretended
away.

Files: `packages/cli/src/apply/execute.ts` and its test,
`packages/cli/src/commands/migrate.ts` and its test,
`packages/cli/test/apply-live.integration.test.ts`.

- [x] 11.1 (~9m) [design] The plan is computed before the lock, so the
      loser's copy is stale by the time it gets in: it re-applies what
      the winner already applied and takes the server's refusal, exiting
      non-zero on a run where nothing is wrong. The requirement calls
      two runners "the ordinary case", and an ordinary case that fails
      half the time is a hole in the implementation, not a case the
      spec declined to cover. **Recheck the ledger inside the lock's own
      transaction**: if the row is already there, close that transaction
      without sending DDL and move on. Check and apply then share one
      lock and one transaction, so nothing can change between them.
      Red: the witness's own first draft, restored — it asserted both
      runners exit zero, which was the right contract written before the
      implementation could meet it. Files: `execute.ts`, its test, the
      witness.
- [x] 11.2 (~8m) The report tells the two apart: what this run applied,
      and what another run applied while this one waited. Both end at
      zero; silence about the second would leave a user wondering why a
      migration they expected to apply is missing from the report.
      Files: `migrate.ts`, its test.
- [x] 11.3 (~2m) The second layer was already there: the ledger's
      `filename` column is declared `not null unique`, so a double
      insert is impossible whatever the logic does. Confirm it and pin
      it — a defence nobody remembers is a defence nobody keeps. Files:
      `apply-ledger.test.ts`.

## 12. Registering a baseline instead of running it

Found in group 10, while editing the skill sentence that says
registering a baseline is the user's pipeline's job. The delta requires
the apply path to record a baseline as applied **without executing its
statements**, and to read the marker through the exported parser — and
nothing in `packages/cli/src` calls that parser. `migrate` sends every
pending file's SQL, so a baseline meets `already exists` on its first
statement: the opposite of the scenario.

**No task owned it.** Task 1.4's red was named "registers a baseline
without executing its statements" and its body proved only that
`recordAppliedMigration` takes no SQL to send. The name claimed the
behaviour; the body proved the function's shape. That is the same defect
this change spent its life finding in other people's tests, and here it
hid an entire unimplemented requirement.

Files: `packages/cli/src/commands/verify.ts` (the chain reader),
`packages/cli/src/apply/plan.ts` and its test,
`packages/cli/src/commands/migrate.ts` and its test,
`packages/cli/test/apply-live.integration.test.ts`.

- [x] 12.1 (~9m) [design] The plan learns which entries are baselines.
      The marker is a banner line and the exported parser reads it by
      prefix; the chain reader already opens every file. Where the flag
      is carried is the design part — `ChainEntry` lives in core and is
      shared with `verify`, so widening it there is a cross-package
      change, while carrying it beside the plan's own entries is not.
      Red: `apply-plan.test.ts` — "marks a baseline entry as registerable
      rather than pending".
- [x] 12.2 (~8m) `migrate` registers a baseline: no statement from that
      file reaches the database, the ledger records it, and the report
      says it registered rather than applied — a user who sees "applied"
      for a file that was never run has been told something false. Red:
      `migrate-command.test.ts` — "records a baseline without sending
      its statements", "reports it as registered, not applied".
- [x] 12.3 (~9m) The live witness: a chain whose first migration carries
      the baseline marker, applied to a database that already has those
      objects. Without the repair this fails on the first statement, so
      the test can fail for the right reason — **record that red's own
      output** (the server's first-statement `already exists`) in the
      commit message. It is the contrast evidence for what 1.4's red
      never produced: a name that claimed the behaviour beside a body
      that only proved a function's shape, and a requirement that stayed
      unimplemented behind it. Red:
      `apply-live.integration.test.ts` — "registers a baseline against a
      database that already has its objects".

## 13. Bringing the split module under the CRAP gate

Found in group 10, by running `pnpm check:crap` to confirm it would not
dirty the README. It did — and then exited 1. The gate runs in two stages
in one command: it rewrites the README block from the live measurement,
then compares that measurement to the threshold. Three functions in
`packages/core/src/engine/split.ts` are over it: `addedEnumValues`
(7.23), `isMatchingLiteral` (7.10), `enumValuesOf` (5.58).

`split.ts` does not exist on `upstream/dev` (measured, both by the
implementer and the lead). This is not inherited debt — **group 4
introduced it and no task owned bringing it under the gate**, though this
change's own `tasks.md` lists `check:crap` as a close-out gate. That is
group 12's shape again: the plan wrote down a requirement and gave nobody
the job of meeting it.

`CRAP = complexity² × (1 − coverage)³ + complexity`, threshold `> 5`
(strict). So at perfect coverage a function's CRAP **is** its complexity,
and the gate's own `Next:` line — "reduce complexity or add tests" —
offers an option that is false for two of these three: no amount of
testing brings a complexity-7 function under 5. Only `enumValuesOf`
(complexity 5) can pass on tests alone, and only at *full* coverage,
where it lands on exactly 5 and the strict `>` lets it through.

**The zero-margin trap follows from the same arithmetic**: a function
sitting exactly at the threshold is green only while its coverage is
perfect. The next uncovered branch anywhere in it turns the gate red
again. Aim below the line, not at it.

Scope pin (lead, #625): the smallest change that makes the gate green,
with **no observable behaviour change**. Group 4R's seal holds — the
`index.ts` diff stays exactly one new export, and every helper this
group extracts stays inside the module. The split machine's output is
pinned by the existing suite and the goldens, so this refactor rides on
a green suite: if it goes red, the refactor changed behaviour and is
wrong, not the test.

There is no failing *test* to start from here; the failing gate is the
red. Each task names which function drops off the gate's list, and the
measurement is `pnpm check:crap`'s own output. It rewrites `README.md`
every run — revert it each time (`git checkout -- README.md`); the README
block is refreshed once, by the lead, at close-out.

Files: `packages/core/src/engine/split.ts`,
`packages/core/test/split.test.ts`.

- [x] 13.1 (~8m) [design] The same "is this a plain JSON object" test is
      written out three times in this file — in `enumValuesOf`, in
      `isMatchingLiteral`, and in `referencesAnyLiteral` — as
      `null` / `typeof !== "object"` / `Array.isArray`. Extracting it
      once (a `JsonValue` → `Record<string, JsonValue> | null` narrowing
      helper) removes three decision points from each caller. This task
      first said "which is why one extraction moves all three flagged
      functions at once" — **that was false, and it is what left 13.4
      unwritten**: `addedEnumValues` does not carry that guard, it calls
      `enumValuesOf` instead, so nothing done here reaches it. The
      design part is whether that helper narrows the type or only
      answers a boolean: only the narrowing form lets the callers drop
      their casts, and the casts are the reason the guards were inlined.
      Red: `check-crap` lists `enumValuesOf`; green: it does not.
- [x] 13.2 (~7m) `isMatchingLiteral` after 13.1 — **measure before
      writing anything.** Complexity counts each `&&`/`||` operand, so
      its final three-term `return` chain carries points that guard
      extraction does not touch; whether it is under the line after 13.1
      is a fact to read off the gate, not to predict. If it is already
      green, do not extract anything and record that the task was
      unnecessary. If not, the remaining shape is reading the literal's
      own value out of the record (`literalKind === "string"` plus the
      string check) as a `string | null`, leaving the caller with one
      comparison against `targets`. Red/green: `check-crap`'s listing of
      `isMatchingLiteral`.
- [x] 13.3 (~8m) `enumValuesOf`'s uncovered paths (71.4% — the gate names
      the file and line; `vitest --coverage` names the branches). Assert
      **behaviour, not lines**: each malformed shape this function
      rejects exists because a snapshot could hold it, and what matters
      to a caller is that such a shape yields no added values and
      therefore no split. A test written to move a coverage number,
      whose name claims more than its body checks, is precisely the
      defect this change spent its life finding — including in its own
      task 1.4. Red: `check-crap` lists `enumValuesOf` at 5.58; green: it
      is off the list, and the assertions say why each rejected shape is
      rejected.
- [x] 13.4 (~9m) [design] `addedEnumValues` — the one this group named in
      its own opening line and then gave to nobody. Its complexity is its
      own control flow: an enum-alter guard (2 operands), a
      null-pair guard (2), a length check, an append-only check. **Two
      extractions, not one**, and the arithmetic is why: taking only the
      trailing "does `next` append onto `previous`, and what did it add"
      pair leaves complexity 5, which at this file's measured coverage
      (91.7%) computes to 5.01 — over a threshold of 5. Also lifting the
      enum-alter guard into a named predicate leaves 4, which is green
      with room. That is the zero-margin trap in the one place it
      actually bites: the smaller refactor *looks* sufficient and fails
      by a hundredth.
      **Measure each extracted helper too** — the walker names every
      function, so complexity relocated into a helper is complexity that
      merely moved, and a helper no test reaches arrives with coverage 0.
      Red: `check-crap` lists `addedEnumValues` at 7.03; green: the gate
      exits 0 with an empty list, which is this group's actual finish
      line.
- [x] 13.5 (~6m) [design] `asJsonRecord`, the helper 13.1 extracted, is
      now the highest value in the whole scan at **exactly 5.00**
      (complexity 5, coverage 100%). It passes only because the gate's
      comparison is strict, and only while its coverage stays perfect —
      the next uncovered branch added to it breaks a gate its author
      never touched. Group 13 wrote "aim below the line, not at it" and
      then left its own helper on the line; 13.4 had just measured what
      that costs (5.01, a hundredth over). The finish line for this group
      is therefore not "exits 0 today" but "exits 0 with room": green
      that survives coverage jitter (lead, #625).
      Only complexity moves this — coverage is already 100%. The guard is
      one three-term test (`null`, `typeof`, `Array.isArray`), so the
      shape to weigh is whether a single expression can say "a plain
      JSON object" without saying it three ways.
      **The task carries its own decision rule** (lead, #625), settled by
      whoever opens the code, with no round trip: *does a natural
      reduction exist?* If the function holds a real simplification — a
      duplicated decision point, a branch that need not be there, a
      change that makes the code better and smaller — take it, and the
      gate's maximum drops below the line. If it is an atomic predicate
      and the only available reduction is splitting it for the metric's
      sake, **leave it** and write the position down here: accepted
      deliberately, because trading a clear guard for an obscure one to
      move a number is gaming the metric, and a gate defeated that way
      stops measuring what it was put there to measure — this change's
      own subject, planted in the code instead of found in it.
      Either branch is a finished task. What is not optional is that the
      decision and its reason are recorded, which is the whole point of
      the ruling: the failure mode being prevented is a future reader
      meeting this at 5.00 with no note saying anyone had looked.
      Red: `check-crap` reports `asJsonRecord` at 5.00 as the scan's
      maximum; green (branch one): the maximum is below 5 and the suite
      is unchanged (97 files, 1449 tests); green (branch two): the
      maximum is still 5.00 and this task says why that was the right
      answer.

## The D106 correction round (groups 14–20)

The adversarial spec-only review of the merged change returned FAIL —
2 blocking, 7 major, 6 minor. **All fifteen are accepted as repairs; none
is rebutted and none is out of scope.** The reason for zero rebuttals is
worth writing down: every finding carries a file, a line, and a command's
output, and a rebuttal needs better evidence than that. There is none.

Three shapes account for almost all of it:

1. **Merge-in staleness in delta prose** (B1, B2). The sibling change was
   merged in; the code and some scenarios were adapted, the delta's own
   sentences were not. One instance was already repaired before the PR
   (`3b7af63d`, scenarios). B1 is the same defect wearing a requirement
   *title*, B2 wearing a `SHALL` sentence and a dropped paragraph.
   **`validate --strict` says "valid" for all three** — the tool that
   catches them is `openspec show <change> --diff`.
2. **Sentences with no observable surface** (M1, M2, M5). A `SHALL` that
   lists a report member the command never prints; a scenario whose
   "reported" means a private function's return shape; six user-facing
   behaviours with no owning sentence. M2 is the one to sit with: this
   change spent thirteen groups finding tests whose names claim what
   their bodies cannot show, and then shipped the same defect as a
   *specification*.
3. **Sentences that assert more than the code does** (M3, M4, m1, m4).
   The chain does not authenticate a migration's SQL body — a fact this
   change recorded in its own flight-recorder entry and then wrote into
   new delta text anyway. The split walk under-approximates in exactly
   the direction the requirement calls unacceptable.

Groups are sequential here, not parallel: they share `plan.ts`,
`raise.ts` and the delta files. Where two findings touch one file they
are in one group, which is why the grouping does not follow the
report's own numbering.

## 14. The two blocking delta repairs (B1, B2)

Files: `openspec/changes/add-apply-engine/specs/cli-commands/spec.md`,
and `openspec/specs/cli-commands/spec.md` as the **source to copy from**.

**Copy the shipped block, do not retype it.** A `MODIFIED` block replaces
what it names, so a sentence lost in transcription is a sentence the
archive deletes silently. Verify with `show --diff`, not with `validate`.

- [x] 14.1 (~9m) B1: the block names `The database driver is an optional
      dependency`; the shipped corpus calls it **`An external tool is an
      optional dependency`** (the sibling renamed it, and another
      capability cross-references the new name). Retitle and carry the
      full shipped text — the `git` sentences, the `history`/`restore`
      parenthetical, and **all three scenarios**; the block currently
      keeps one. Then add the apply-trade sentence. Green:
      `show --diff` prints no "No matching main requirement" warning.
- [x] 14.2 (~8m) B2: `A run that finds no difference SHALL write nothing`
      contradicts two scenarios inside its own block, the shipped
      `schema-export` capability, and the implementation. Restore the
      shipped `SHALL write no migration and no snapshot` and the dropped
      export paragraph (`This SHALL hold even when there is no difference
      to write a migration for`). The split additions stay as they are.

## 15. The delta sentences that overstate (M3, M5, M6, M7, m1, m3–m6)

Files: the `migration-apply` and `migration-format` delta specs.
Prose only — the code these sentences describe moves in groups 16–19,
and the sentences must be written to match what those groups land.

- [ ] 15.1 (~8m) M3's prose: state that the chain vouches for the
      **snapshot hashes**, not for a file's SQL bytes, and that this is
      *why* the transaction-control refusal exists. Rewrite the scenario
      to the true contract (a banner line edited, a file removed or
      reordered). The current WHEN describes a class of edits most of
      which pass.
- [ ] 15.2 (~9m) M5, part one: `migrate`'s three-way exit code, and the
      shared `--url` / `DATABASE_URL` rule for the connecting commands —
      including the shipped security sentence's extension (**not** read
      from `hejbro.config.ts`). The corpus pins exactly this for `check`;
      four new commands inherited the behaviour and none of the words.
- [ ] 15.3 (~8m) M5, part two: `raise --file`, `reset --confirm-drop` and
      its `<database>:<count>` token, and `migrate`'s report buckets.
      Apply the admission test — a sentence earns its place by pinning
      something a reader cannot get from another sentence.
- [ ] 15.4 (~7m) [design] M5, part three + M7's prose, **written
      together**: the ledger's identity (schema, table, columns) and the
      origin discriminator group 16 adds. These are one decision about
      one durable object; writing them in two passes would settle its
      shape twice. Record that no compatibility path is owed because
      nothing is published yet.
- [ ] 15.5 (~5m) M6's prose: either the zero-change carve-out is stated
      or the implementation refuses first. Group 18 chooses; this task
      writes whichever it chose.
- [ ] 15.6 (~8m) The minors: m1 (`before any *migration* statement is
      sent`), m3 (`the format-version line` misnames the hejbro-version
      line — the MODIFIED block inherited the misnomer and can fix it),
      m4 (raise refuses net-of-rollback, and says so), m5 (reset's two
      SHALLs under declaration drift), m6 (drop `and a configuration
      default` — there is none).
- [ ] 15.7 (~6m) m2: the **shipped** `cli-commands` Purpose already
      promises the four commands, whose requirements live in the
      unarchived `migration-apply`. Point it at that capability. First
      measure who wrote that Purpose line and when (`git log -p`) — a
      Purpose edited ahead of its requirements is worth understanding
      before it is patched.

## 16. The ledger's origin, and the surfaces that read it (M7, M1, M2)

Files: `packages/cli/src/apply/ledger.ts`, `apply/plan.ts`,
`apply/raise.ts`, `commands/raise.ts`, `commands/status.ts` and their
tests.

M7 is the round's only real design fork and the lead settled its
direction: **a ledger column, not a filename convention** (a filename
marker collides with "a row identifies its migration by the full
filename" and is stringly). The window matters — the ledger is a
permanent object in a user's database and **nothing is published yet**,
so its shape is free to change today and not tomorrow.

- [ ] 16.1 (~9m) [design] The discriminator: its column name and its
      value set (chain-applied / baseline-registered / raised). Settle it
      with 15.4 in the same breath. Red: `apply-ledger.test.ts` — "records
      how a row entered the ledger".
- [ ] 16.2 (~8m) `planApply` stops classifying a non-chain row as
      `apply-ledger-orphan-row`. Today a raised database makes `status`
      exit 1 and `migrate` refuse with "resolve the mismatch by hand" —
      one requirement mandates creating exactly the state another
      mandates reporting as blocking. Red: `apply-plan.test.ts` — "a
      raised row is not an orphan".
- [ ] 16.3 (~9m) M1 + M2 together, because they are one command's output:
      `status` gains an applied section, and says **which** of the two
      empty states it found (no ledger table at all vs. a ledger with no
      rows). The distinction exists today only as a private union that
      `planApply` flattens before anything can print it — the scenario's
      "reported" has no observer. Red: `status-command.test.ts` — "names
      the migrations the ledger records", "tells an absent ledger from an
      empty one".
- [ ] 16.4 (~7m) `raise` writes its row with the raised origin, and
      `status` says the database was raised from that file rather than
      listing it as a migration nobody has.
- [ ] 16.5 (~6m) m4's half of the ordering family: `bootstrapLedger` runs
      *after* the emptiness check, so a database `raise` refuses does not
      keep `hejbro.migration_ledger` as a souvenir.

## 17. migrate verifies before it connects (M3, code)

Files: `packages/cli/src/commands/migrate.ts` and its test.

- [ ] 17.1 (~8m) The chain check is **offline** (`checkChain` reads banner
      lines), so it can run before the connection is opened. Today the
      order is connect → probe → capability → **bootstrap (two DDL
      writes)** → read → plan → chain check, so a run refused for an
      unverifiable chain has already created a schema and a table in a
      database it then refuses to touch — and our own sentence says "no
      statement is sent". Red: `migrate-command.test.ts` — "refuses an
      unverifiable chain without opening a connection".

## 18. reset's unconfirmed destructive path (M6)

Files: `packages/cli/src/apply/reset.ts`, `commands/reset.ts`, tests.

- [ ] 18.1 (~9m) [design] A `reset` whose declarations export nothing
      computes an empty drop list, asks for no confirmation, exits 0 —
      and still runs `clearLedger`, emptying the ledger of a database
      whose objects are all still standing. The next `migrate` then
      re-applies the chain onto objects that exist. Two repairs are
      available and the corpus prefers the first: refuse an empty
      declaration set the way `check` and `baseline` already do, **and**
      move the ledger clear under the confirmation. Red:
      `reset-command.test.ts` — "refuses a declaration set that exports
      nothing", "clears no ledger row without confirmation".

## 19. The split walk sees text, not only literal nodes (M4)

Files: `packages/core/src/engine/split.ts`,
`packages/core/test/split.test.ts`,
`packages/cli/test/apply-live.integration.test.ts`.

The requirement says the decision is made from the statements the run is
about to emit and that it **over-approximates**. The walk matches encoded
literal nodes only, so a value spelled inside a `sql` template's text
chunks or a `sql.raw` node is invisible — and both encodings appear in
committed examples, inside slots this same requirement enumerates
(a check constraint, a policy's `using`). That is under-approximation in
the direction the requirement's own rationale exists to forbid.

**This reopens the file the CRAP gate broke on.** Group 13's rules apply:
aim below the line, and measure every helper the work extracts.

- [ ] 19.1 (~8m) [design] The match rule for raw text. Substring on the
      value's spelling is licensed by the stated over-approximation, but
      *how far* it over-approximates was never settled — a value spelled
      inside an unrelated word or a comment would split a run that did
      not need it. Decide and write it down; D106 will read it again.
- [ ] 19.2 (~9m) The walk reaches `chunkKind: "text"` chunks and
      `nodeKind: "raw-sql"` nodes. Red: `split.test.ts` — "splits when the
      added value is spelled inside a sql template", "…inside sql.raw".
      The over-approximation direction already has a test; this is the
      direction that had none.
- [ ] 19.3 (~6m) Re-measure the gate. `pnpm check:crap` must exit 0 with
      room, not at the line, and every helper this group adds is measured
      by name.
- [ ] 19.4 (~9m) The live witness the report marked UNVERIFIED: a run
      that adds an enum value and a check constraint spelling it, applied
      against a real server. Without 19.2 it takes `55P04`; with it, two
      migrations apply. Red: `apply-live.integration.test.ts`.

## 20. The gate sentences, and the round's own close-out

Files: this file, `.changeset/`.

- [ ] 20.1 (~6m) Add `openspec show <change> --diff` by name to the
      merge-in gate sentence (beside the `validate --strict` line added
      in `e8e0aee9`) and to the archive-time list below, with the reason:
      **whether a `MODIFIED` block names a requirement that exists is a
      question `validate` does not answer** — it called this change valid
      while a block named nothing.
- [ ] 20.2 (~5m) One changeset for the round: `@hejbro/core` and `hejbro`
      both move, and the seven published packages version together.

## Verification

- **At archive time, read the rolled-up main specs and confirm they say
  what these deltas meant.** A sibling piece measured `openspec archive`
  applying none of its `REMOVED` requirements while `validate` stayed
  green — so passing validation and being applied are two different
  facts. This change's deltas are `MODIFIED` and `ADDED` only, which is
  not the shape that failed there, and that is exactly why the check is
  worth doing rather than assuming: nobody has measured whether
  `MODIFIED` applies cleanly either. Compare the resulting main spec
  against the delta by diff, not by eye.
- **Then run the corpus check, not just the change's own.** After
  archiving, `openspec validate --specs --strict` reads every capability
  in the corpus; the change-level `validate --strict` does not, and a
  sibling piece found the difference the hard way — two newly created
  capabilities whose deltas carried no Purpose prose were rolled up with
  the tool's own `TBD` placeholder, and only the corpus run said so.
  This change's new capability ships its Purpose in the delta, so the
  placeholder cannot appear here; the corpus run is what makes that a
  checked fact rather than a belief about a tool.
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
