# Tasks: harden-query-conformance

Three groups. Every file has exactly one owner — no file appears in two
groups. Estimates are pure work minutes (D88). Every task is test-first:
the named test goes red first, then the minimal green, then refactor.

**Source files edited outside `packages/query`**: `packages/core/src/expr/
render-sql.ts` (group 2) only. Group 1 edits two **test** files of
packages whose sources it must not touch (`packages/supabase`,
`packages/pg`); if a task appears to need a source edit in either, that
goes back to the planner, not into the diff.

**Ordering.** The three groups share no file and can run in any order.
Inside group 1, 1.2 makes 1.3's test red, so 1.3 follows it.

## 1. The conformance kit's obligations

- [x] 1.1 (~8m) **[design]** The `session-state: false` obligation becomes
      the sentence it implements: a statement precedes the caller's own,
      and nothing is asserted about what follows. Settles the violation
      message for the "nothing preceded it" case, which is now the only
      thing this half reports. Red:
      `packages/query/test/driver/conformance.test.ts`, new case *"the
      false tier asks only that a statement precedes the caller's own"*,
      driven by an input table spanning the sentence rather than one
      example — caller last after a settings statement (passes today,
      must keep passing); caller followed by one trailing statement;
      caller followed by several; caller first with nothing ahead of it
      (violation); caller absent from the list (violation); an empty
      list (violation). The trailing-statement rows are the red. The
      kit's tsdoc for this half is corrected in the same task: the
      observation's domain is the statements crossing the contract's
      `execute`, and "last" is not part of the obligation. Files:
      `packages/query/src/testing/driver-conformance.ts`,
      `packages/query/test/driver/conformance.test.ts`.
- [x] 1.2 (~10m) **[design]** The transaction-envelope obligation for a
      driver declaring interactive transactions `true` and session state
      `false`. Settles three contract details: the observation's own
      shape (a variant carrying the statements the driver emits on its
      connection, transaction control included — required for this
      declaration, so an observation shaped for the plain `false` tier
      is refused, matching how the kit already refuses a wrong-tier
      shape); which statements count as transaction control (SQL's own
      vocabulary, matched as whole statements, case-insensitively — the
      kit reads no driver's settings text and gains no exception to
      that); and the violation message for each way the envelope can be
      wrong. A statement is transaction control only when the whole
      statement is one of those words (trimmed, case-insensitive): a
      statement that merely *contains* one — a function body's own
      `do $$ begin … end $$`, a caller's statement with the word in a
      string literal — is an ordinary statement, and the input table
      carries a row for each so the matcher cannot pass by being greedy.
      Red: same file, new cases *"settings sent before the
      transaction opens are caught"* and *"an envelope-blind observation
      is refused for a transaction-keeping driver"*, driven by an input
      table of envelopes — open/settings/caller/end (conforms);
      settings/open/caller/end (violation); open/settings/end/open/
      caller/end (violation); open/caller/end (violation, nothing
      precedes); caller with no transaction at all (violation); and the
      plain `false`-tier observation shape handed to this declaration
      (refused). The tsdoc records why the session-level surface cannot
      answer this — the statement that opens a transaction is not one it
      records. Before moving on, name the discriminating mutant and both
      of its halves: sending the settings one position earlier, ahead of
      the transaction's opening, must turn these cases red while every
      case in 1.1 stays green. If both move together, the new obligation
      is guarding nothing. Files: those two.
- [x] 1.3 (~7m, actual ~4m work + planner round-trip wait — see note) The
      Supabase pooled-transaction driver's own conformance check feeds
      the wire-level envelope
      instead of the session-surface list. Red: `packages/supabase/test/
      pooler.test.ts`'s case *"conforms to the session-state:false
      tier"* now throws — the observation it hands the kit cannot show
      transaction control. Green by recording through the
      envelope-recording fixture that already exists in that file, so
      the driver's real `BEGIN`/pins/caller/`COMMIT` order is what the
      kit judges. No `packages/supabase/src` file is edited: if the
      driver itself turns out to violate the obligation, that is a
      finding for the planner, not a fix here. Report, with this task,
      which obligation each in-repo driver ended up under and how it
      answered — `@hejbro/pg`, the Supabase session and pooled paths,
      and both Neon paths — since only one of the five reaches the new
      obligation and the other four are the evidence that it left them
      alone. Files: `packages/supabase/test/pooler.test.ts`.

      Note: 1.2 landing also broke `pooler.test.ts`'s own task-1.6
      "red/green contrast" test (not named above) — its premise ("the
      kit's session-surface observation silently passes a pins-before-
      BEGIN fixture") stopped being true once 1.2's shape guard refuses
      that observation for this capability combo outright. Rebuilt (lead
      ruling QC-G1-R1-02) to pin the fixed behavior on two independent,
      distinctly-asserted layers instead of the superseded gap; a repo
      sweep confirmed it was the only test 1.2 broke outside this
      task's own named red.

## 2. Whole-table projection under a join

- [x] 2.1 (~9m) **[design]** A whole-table projection renders each column
      qualified by the select's own from-source when the select carries
      at least one join, and unchanged when it carries none. Settles the
      rendered text: the qualifier is the from-source as the `from`
      clause itself renders it (a table schema-qualified, a CTE
      reference bare), so the projection and an object projection's
      column reference agree character for character. Red:
      `packages/core/test/query/select.test.ts`, new case *"a whole-table
      projection is qualified once a join is in scope"*, driven by an
      input table spanning "every projected column": no join (bytes
      unchanged — the pin); one inner join; one left join; two joins; a
      CTE from-source with a join; and a join whose two tables declare
      the same column name, where the unqualified text is SQL the server
      itself refuses as ambiguous. Files:
      `packages/core/src/expr/render-sql.ts`,
      `packages/core/test/query/select.test.ts`.
- [x] 2.2 (~7m) Every committed artifact carrying the changed shape is
      regenerated in the same commit and read line by line to confirm
      qualification is the only difference. Red: whichever golden or
      round-trip test 2.1 turns red (report the list when it is known —
      if none turns red, that is the finding: no committed artifact
      carries a joined whole-table projection, and it is recorded here
      rather than assumed). Files: the regenerated artifacts only.

      Observed (full repo sweep of every `innerJoin`/`leftJoin` call site
      in `packages/*/test/**` and `examples/**`, reported to planner
      before touching anything): exactly one file turned red --
      `packages/query/test/compile/join.test.ts`'s two "with qualified
      columns" cases (their own title already claimed qualification;
      their golden SQL didn't). Diff read line by line: 2 lines changed,
      each adding only the `"app"."posts".` qualifier prefix to `"id"`/
      `"status"` -- from-clause, join-clause, on-condition, and the
      `not.toContain("*")` line byte-identical. Every other whole-table+
      join site checked either asserts a substring that doesn't include
      the projection list, wraps in `exists()` (constantOne projection,
      unaffected), is a structural/type-only check, or is an
      object-projection (never `allColumns`) to begin with -- none
      carries a joined whole-table projection's SQL text as a golden.
      `examples/**` (9 schema files' `defineView`s) and
      `packages/{pg,supabase,neon}/test/**` (read-only) checked and
      confirmed clear; nothing there needed the planner's edit
      permission. `pnpm --filter core vitest run` (package-local, all
      files): 1510 passed, 3 failed (pre-existing
      `cross-instance-symbols.test.ts` dist-freshness ENOENT, unrelated
      to this change). `packages/query` and `packages/supabase` full
      suites: 872/872 and 141/141.

## 3. A core-built set operation's execute result type

- [x] 3.1 (~8m) **[design]** `ExecuteResult` resolves a core-built
      set-operation stage to the left branch's declared row shape — the
      projection that stage carries — instead of the driver's raw row
      shape. Settles which left-join tracking the resolved shape is
      given: a set-op stage carries none, so it takes the same untracked
      value a select that never joined would take, which widens rather
      than narrows. Red: `packages/query/test/db/execute-result-type.
      test.ts`, new case *"a core-built set operation reads back as its
      left branch's row"*, driven by an input table — a whole-table
      union; an object-projection union; a stage further chained with
      `orderBy`/`limit`; an already-unwrapped node (unchanged, the raw
      driver row); a mutation chain (unchanged). The evidence is
      `check-types` over the workspace, never the test runner:
      `expectTypeOf` is a runtime no-op. Files:
      `packages/query/src/db/db.ts`,
      `packages/query/test/db/execute-result-type.test.ts`.

## 4. Review repairs

- [x] 4.1 (~9m) **[design]** Transaction control is recognized by the
      keyword a statement leads with, after normalizing (trim, lower-case,
      drop a trailing semicolon): `begin`/`start transaction` open,
      `commit`/`rollback`/`abort`/`end` close. A statement that only
      manipulates a savepoint is neither. Settles which spellings the kit
      sees, which the requirement now states. Red:
      `packages/query/test/driver/conformance.test.ts`, the envelope input
      table gains rows for the five closing spellings measured to end a
      transaction on a real server (`COMMIT;`, `commit work`,
      `commit transaction`, `end transaction`, `abort` — each must be
      caught, all five pass today), the four opening spellings that are
      wrongly refused today (`begin work`, `begin transaction`,
      `begin isolation level serializable`, `start transaction read only`,
      plus `BEGIN;`), and three savepoint rows (`savepoint s`,
      `release savepoint s`, `rollback to savepoint s` — none of them a
      boundary). The existing `do $$ begin … end $$` and string-literal
      rows stay as the controls that the leading-keyword match must not
      swallow. Re-run mutants M1–M3 afterwards (commit, mutate,
      `git checkout --`). Files:
      `packages/query/src/testing/driver-conformance.ts`,
      `packages/query/test/driver/conformance.test.ts`.
- [x] 4.2 (~5m) The two corrected set-operation scenarios get the
      observers they name: a `tsc` pin for the whole-table form (identical
      to the branch read alone) and one for the object-projection form
      (the left branch's keys, widened with null). No production change —
      `ExecuteResult` keeps the untracked widening, which is what the
      corrected sentence describes. **No red is available**, so the
      discriminating check is the mutant: switch the branch's second type
      argument to `never` and the object-projection pin must fail while
      the whole-table pin stays green. Evidence is `check-types`, not the
      test runner. Files:
      `packages/query/test/db/execute-result-type.test.ts`.

- [x] 4.3 (~4m) Three spellings the leading-keyword rule newly decides,
      pinned so the rule's edges are stated by tests rather than inferred:
      `commit and chain` and `rollback and chain` end a transaction (both
      measured to discard a transaction-local setting on a real server),
      and an opener carrying leading whitespace and a newline is still an
      opener. Red: `packages/query/test/driver/conformance.test.ts`, three
      rows added to the envelope input table. Files: that file.

## 5. Observers the review found missing

- [x] 5.1 (~7m) The checkout scenario's first clause gets an observer: a
      decorator that returns a NEW driver value carrying its own hook does
      not reach the base's checkout. Red:
      `packages/pg/test/driver.test.ts`, new case — spread the real
      `pgDriver` into `{ ...driver, setupSession: spy }`, run `execute`
      through it, and assert the wire is the base's own two pin statements
      followed by the caller's statement with the spy never called. **No
      red is available** (this pins behavior that already holds), so the
      discriminating mutant is named instead: make the decorator ALSO
      overwrite the base's member in place — the thing the scenario denies
      — and this case must fail while the existing in-place case at
      `driver.test.ts:711` stays green. `packages/pg/src` is not edited.
      Files: `packages/pg/test/driver.test.ts`.
- [x] 5.2 (~5m) The set-operation pins stop measuring themselves. The
      existing expectation is written as `ReadonlyArray<SelectResult<
      Projection>>` — the same type expression the implementation
      evaluates — so it holds however that expression resolves. Replace it
      with an independent oracle: the type of the same handle executing
      the left branch alone. Red: `packages/query/test/db/
      execute-result-type.test.ts` — against the honest oracle the
      whole-table row passes and, with the fixture's column changed to a
      `notNull` one, the object-projection row states the widening
      explicitly rather than hiding it in an already-nullable column.
      Evidence is `check-types`. Files: that file.

## Close-out (not a group)

The changeset, `openspec/task-times.csv`, and the README stamps
(`pnpm check:tasktime`, `pnpm check:crap`) land in one close-out commit
at PR time, so no group's branch can conflict on them.
