# Tasks: add-check-schema

Seven groups, no file shared between any two. Everything lands in
`packages/cli` — `@hejbro/core` is unchanged (`diffSnapshots`,
`decodeExprNode`, `renderExpr`, `renderTypeNode` are already public), and
no file under `packages/core`, `packages/query` or `packages/pg` is
touched. Estimates are pure work minutes (D88).

The catalog queries and the type/default normalizations are ported from
`scripts/check-declared-vs-catalog.mjs`, which already compares a declared
snapshot to a live catalog and measured those normalizations against a
real server (#218). Porting is not copying: the script reads a snapshot
file and shells out to `psql`; this reads the in-memory declared snapshot
and goes through the driver.

## 1. The connection and the catalog reads

- [x] 1.1 (~8m) [design] Connection resolution: `--url`, else
      `DATABASE_URL`, else a coded refusal. The [design] part is the flag
      name, the precedence, and that a connection string is never read
      from `hejbro.config.ts` (committed file, secret value) — the spec
      states the rule, this settles the surface. Red:
      `packages/cli/test/check-driver.test.ts` — "prefers --url over
      DATABASE_URL", "refuses with a coded error when neither is given".
      Files: `packages/cli/src/check/driver.ts`, that test.
- [x] 1.2 (~7m) The driver is imported dynamically and its absence is a
      hejbro diagnostic naming the package to install, never a
      module-resolution error. Red: same test — "names the package to
      install when the driver is missing". Files:
      `packages/cli/src/check/driver.ts`, that test.
- [x] 1.3 (~9m) The catalog reads, as read-only statements over the
      driver contract: schemas, tables, columns, constraints, indexes,
      enums, sequences, functions, views, policies, triggers, and the
      three grant inventories. No declared value is ever interpolated —
      each read fetches its whole inventory and the comparison happens in
      TypeScript, so there is no identifier-escaping question to get
      wrong. Red: `packages/cli/test/check-catalog.test.ts` — "issues
      only parameterless read-only statements", "returns the catalog rows
      the comparison needs". Files: `packages/cli/src/check/catalog.ts`,
      that test.

- [x] 1.4 (~8m) Every catalog read is role-independent, and a read that
      fails says so. Table grants come from `aclexplode(pg_class.relacl)`
      — not `information_schema.role_table_grants`, which by definition
      shows only the grants the connected role is party to, so a limited
      role would read a real grant as absent and the command would report
      a confident, wrong "missing". The two neighbouring grant reads
      (schema usage, default privileges) already use `aclexplode` on the
      catalog directly; this makes the third consistent, and the mismatch
      was invisible in `check-declared-vs-catalog.mjs` only because it
      runs as superuser. The access list SHALL be read in its effective
      form — `aclexplode(coalesce(relacl, acldefault('r', relowner)))` —
      because an empty `relacl` means "the owner's default privileges",
      not "no privileges", and `aclexplode(NULL)` returns no rows: the
      view being replaced expands that default, so switching without
      `acldefault` would bring the same wrong "missing" back through the
      other door, for any project that grants to the owning role. A
      catalog read that errors outright SHALL fail the command with
      `check-catalog-unreadable`, never be silently read as "the object
      does not exist". This task also settles how a grantee is spelled
      (`grantee = 0` is `public`, otherwise `pg_get_userbyid(grantee)` —
      *not* `grantee::regrole::text`, which quotes an identifier when it
      needs to, so a role named `Reader` reads back as `"Reader"` and
      never matches the declaration), which 2.4's grant comparison
      consumes — so it lands before 2.4.
      Red: `packages/cli/test/check-catalog.test.ts` — "reads table
      grants without depending on the connected role", "does not report
      an owner's default privileges as missing on a table with no
      explicit grants", "fails with a coded error when a catalog read is
      refused". Files: `packages/cli/src/check/catalog.ts`, that test.

- [x] 1.5 (~8m) Not reaching the database is its own failure, with the
      driver's own reason attached. Measured on a real server: a wrong
      port produces `error[check-catalog-unreadable] … could not read
      the database catalog: .` — an empty reason, and advice about
      `pg_catalog` privileges on a database that was never reached.
      node-postgres reports a refused connection as an `AggregateError`
      whose own `message` is empty and whose causes sit in `errors[]`,
      so the message extractor must flatten that (and fall back to the
      error's `code` or its string form rather than emit nothing).
      Connectivity gets its own code, `check-connection-failed`,
      established by one trivial read before the catalog reads begin —
      classifying driver error codes after the fact is guesswork, asking
      "can I talk to this database at all?" is not. Red:
      `packages/cli/test/check-driver.test.ts` — "reports a refused
      connection with the driver's own reason, not an empty one",
      "distinguishes an unreachable database from an unreadable
      catalog". Files: `packages/cli/src/check/driver.ts`,
      `packages/cli/src/check/catalog.ts`,
      `packages/cli/src/check/expression.ts` (the same extractor), those
      tests.

## 2. The comparison, as a pure function

Catalog rows in, findings out. No I/O in this file — that is what lets
the whole comparison run in CI with no database (the CI has none: no
`services:`, no docker, no postgres anywhere in `ci.yml`).

- [x] 2.1 (~9m) [design] The finding shape: one per object, carrying the
      object's identity, a code and a `Next:` line. The [design] part is
      the code set and the message shape, which are user-facing contract
      and are what the report and every later test assert against. The
      whole set is settled **here**, not in the group that first raises
      each one, or the groups drift into different message shapes:
      `check-object-missing`, `check-object-differs`,
      `check-not-compared`, `check-constraint-not-enforced`,
      `check-declarations-empty`, `check-connection-missing`,
      `check-driver-missing`, `check-catalog-unreadable`,
      `check-connection-failed` (the last two are raised in 1.4 and 1.5,
      but owned here — the whole point of one owner is that a code born
      elsewhere still gets its shape from this list). Inventory lines
      (5.1) carry no code — they
      are not errors. Every code SHALL originate through core's
      `hejbroError`/`throwHejbroError` factory: `check-next-marker.mjs`
      only inspects those call sites, so a code built as a bare
      `{ code }` literal would silently escape the `Next:` gate.
      Precedence is part of the shape: *missing* outranks *not
      compared*, so an absent object is reported once. Red:
      `packages/cli/test/check-compare.test.ts` — "reports a missing
      table by its identity". Files:
      `packages/cli/src/check/compare.ts`, that test.
- [x] 2.2 (~8m) [design] Column type comparison, including the measured display
      corrections (`time`/`timestamp` spell out "without time zone",
      `varchar`/`char` use their long names, `numeric(p)` gains an
      explicit `,0`) and enums compared by their base type's
      schema-qualified name — never `format_type()`'s enum spelling,
      which is `search_path`-sensitive. Red: same file — "reports a
      column declared text that the catalog has as varchar(120)", "does
      not report an enum column as differing because of search_path".
      Files: `packages/cli/src/check/compare.ts`, that test.
- [x] 2.3 (~7m) [design] `notNull` and default comparison with the
      measured normalizations only: whitespace, one trailing `::type`
      cast on a literal default, and the quotes Postgres adds around a
      negative numeric literal. The [design] part is the *closure* of
      that list: each entry is measured, but "these three and no more" is
      a decision about where a false pass begins — a wider rule (a
      blanket case-fold, stripping casts inside a compound expression)
      buys agreement by accepting things that genuinely differ. Red: same
      file — "accepts a default the catalog stored with a trailing cast",
      "reports a default the declaration has and the catalog does not".
      Files: `packages/cli/src/check/compare.ts`, that test.
- [x] 2.4 (~8m) Existence by identity for every declared kind, and the
      refusal to report a clean result for zero declared objects. Grant
      identity uses the grantee spelling 1.4 settles (`public` for the
      zero OID, `regrole` text otherwise); this task consumes that
      decision rather than making a second one. Red: same file —
      "reports a missing policy, trigger and grant by identity",
      "refuses an empty declaration set with its own code". Files:
      `packages/cli/src/check/compare.ts`, that test.
- [x] 2.5 (~9m) The declared objects that live *inside* a table are
      compared for existence too: primary key, unique constraints,
      foreign keys, check constraints, and indexes. They are declared,
      they can be absent from a database, and a `check` that stays quiet
      about a missing index or foreign key is not checking the thing its
      user believes it is. They are not separate kinds, which is exactly
      why 2.4's kind walk misses them — the reference script
      (`check-declared-vs-catalog.mjs`) checks all five, and the catalog
      reads for them already landed in 1.3. Existence only: a check
      constraint's *expression* is 3.4's, and an index's predicate is
      3.2's, so this task finds the object and those tasks compare its
      contents. Red: same file — "reports a missing index, foreign key
      and check constraint by identity", "reports a declared primary key
      the table does not have". Files:
      `packages/cli/src/check/compare.ts`, that test.

(The "a refused read must not read as absence" requirement is met in
1.4, not here. Measured while starting this group: every catalog read
this command makes is over `pg_catalog`, which is world-readable, so a
limited role cannot silently see less — *except* through
`information_schema.role_table_grants`, which is role-filtered by
definition. Removing that one dependency removes the blind spot at its
source, which is better than plumbing a "this was refused" signal
through a pure function that nothing could ever set. A read that fails
outright is a coded error, also in 1.4.)

## 3. Expression comparison

Both sides are rendered by the same server in the same session. Comparing
our rendered text to the catalog's text directly was measured at 14 false
positives in 23 expression fields — 8 of 8 check constraints — because
Postgres rewrites expressions on write.

- [x] 3.1 (~10m) [design] The probe form — **settled: the expression
      goes in the select list**, `SELECT (<expr>) FROM <table>`, and the
      comparison reads the plan's `Output`. Never a `WHERE` predicate: a
      qual is subject to the planner and to row-security rewriting, an
      output expression is neither. Measured against both forms on the
      same fixtures — identical cancellation (8 of 8) and identical
      detection (6 of 6), while the select-list form alone survives the
      two hazards in 3.2 and 3.3. Consequence worth stating: no `SET` is
      needed, so this command depends on **no** driver capability beyond
      the parameterless reads every driver must already support. Both
      renderings SHALL come from **one statement** —
      `SELECT (<declared>), (<catalog>) FROM <table>`, two entries in one
      plan's `Output`. Two statements were the first shape and it was
      wrong: a pooling driver can put them on two connections whose
      `search_path` differs, and the assertion "one session object was
      passed" cannot see that, because passing one object is structurally
      always true. One statement is enforceable — the test counts
      `execute` calls — and it is the only way to pin a connection
      without a transaction. Two assertions carry it: `execute` is called
      **once**, and the plan's `Output` holds **two** entries. The second
      is not pedantry — when the comparison succeeds both expressions
      render to the *same* text, and whether Postgres keeps two identical
      target-list entries or folds them into one is a fact about a
      server, not something a fake session can establish. Measure it on a
      real one before trusting the fixture, the way the plan JSON's shape
      was measured; if it folds, every agreeing constraint reports as
      not-compared. When that one statement errors, neither side was
      rendered, so the finding is not-compared with the server's own
      reason **and both expression texts** — a server message naming a
      column tells the user nothing about which of the two declarations
      to go read. Red: `packages/cli/test/check-expression.test.ts` —
      "renders both sides through the server and reports no difference
      for a rewritten `in (...)`", "reports a constraint whose bound
      differs", "obtains both renderings from a single statement". Files:
      `packages/cli/src/check/expression.ts`, that test.
- [x] 3.2 (~8m) The rendering is read from the plan without depending on
      the plan's shape. Guard the hazard directly: the same comparison
      must hold with an **index** on the probed column. Measured — a
      `WHERE` probe flips from `SeqScan`/`Filter` to
      `BitmapHeapScan`/`RecheckCond` + `IndexCond` (the predicate lands
      in two places at once) while the select-list probe's `Output` is
      byte-identical before and after. Red: same file — "compares
      identically with and without an index on the probed column". Files:
      `packages/cli/src/check/expression.ts`, that test.
- [x] 3.3 (~7m) The uncomparable classification: when a rendering cannot
      be obtained — a privilege is missing, the server refuses the
      expression — the object is reported as not compared **with the
      reason** and is never counted as agreeing. This is what keeps the
      command from reintroducing the silent pass it exists to end. Also
      the regression guard for 3.1's choice: under a role with **no
      policy** on the table, two genuinely different expressions must
      still be reported as different (measured: the `WHERE` form collapses
      both to `One-Time Filter: false` and reports agreement — the select
      list form does not). A missing object stays *missing*: an
      expression that could not be probed because its table does not
      exist is not a second, uncomparable finding. Red: same file —
      "reports not-compared with a reason when no rendering can be
      obtained", "still reports a real difference under a role with no
      policy on the table", "reports a declared table's absence once, not
      again as not-compared". Files:
      `packages/cli/src/check/expression.ts`, that test.
- [x] 3.4 (~6m) The catalog side of a check constraint comes from
      `pg_constraint.conbin` through `pg_get_expr` — it yields the bare
      expression, so there is no `CHECK (...)` wrapper to strip and no
      regex to be defeated by a `NOT VALID` or `NO INHERIT` suffix.
      Because `conbin` also drops `NOT VALID` itself, enforcement is
      compared separately from the expression: a constraint the database
      is **not enforcing on existing rows** (`convalidated` false) is
      reported even when its expression matches, since the declaration
      claims an invariant the database does not hold. Red: same file —
      "compares a NOT VALID constraint by its expression", "reports a
      matching constraint the database does not enforce". Files:
      `packages/cli/src/check/expression.ts`, that test.

## 4. The command surface and its report

- [x] 4.1 (~8m) [design] A value-taking flag is registered in
      `flags.ts`'s own list, not just parsed locally: that file states
      the rule and predicts the failure — a fifth value-taking flag that
      skips it "silently keeps requiring the space form". `--url` was
      that fifth flag, and `--url=…` was dropped while `--url …` worked,
      so the command answered "neither --url nor DATABASE_URL is set"
      to a user who had just passed `--url`. With `DATABASE_URL` also
      set it is worse than a wrong message: the flag is ignored, a
      *different* database is checked, and the confident result is about
      the wrong server. Subcommand registration, description and flag
      surface. The [design] part is the user-facing text and the flag
      set; `check` is a new command and everything it prints is contract.
      Red: `packages/cli/test/help.test.ts` — "lists check among the
      commands"; `packages/cli/test/check-command.test.ts` — "prints its
      flags". Files: `packages/cli/src/commands/check.ts`,
      `packages/cli/src/main.ts`, those two tests.
- [x] 4.2 (~9m) The report and the exit codes: findings grouped by
      object, non-zero when any declared object is missing or differs,
      zero when none do. The "never a diff" rule needs an assertion that
      can fail: a report can carry object identity *and* dump a diff, and
      every other test here would still pass. Red:
      `packages/cli/test/check-command.test.ts` — "exits non-zero and
      names the object when a column type differs", "exits zero when
      everything agrees", "emits no diff hunk markers (`@@`, `+++`,
      `---`) anywhere in its report". Files:
      `packages/cli/src/commands/check.ts`, that test.
- [x] 4.3 (~7m) The coverage-boundary statement: the report says what it
      did not compare — view bodies, existence-only axes, and that its
      reads are **not** taken as one snapshot, so a schema changing
      mid-run can produce a torn report. That last one is the price of
      opening no transaction (the property that keeps this command free
      of any driver capability); a command whose whole ethic is naming
      its own blind spots does not get to leave that one unsaid. Red:
      same file — "states what it does not compare even when it finds no
      differences", "says its reads are not a single snapshot". Files:
      `packages/cli/src/commands/check.ts`, that test.

- [x] 4.4 (~8m) The expression comparison is actually reached: `check`
      walks the declared check constraints and puts each through group
      3, merging those findings with the catalog comparison's. Group 3
      built the comparison and nothing called it — a gap this plan left
      between "the command wires the pieces together" and a task list
      that named the pieces separately. An unreached comparison is worse
      than a missing one: every test passes, the report says nothing, and
      the silence reads as agreement. Red:
      `packages/cli/test/check-command.test.ts` — "reports a check
      constraint whose expression differs", "compares every declared
      check constraint, not only the tables around them". Files:
      `packages/cli/src/commands/check.ts`, that test.

- [x] 4.5 (~9m) The exit code answers three questions, not two: `0`
      agreed, `1` the database disagrees, `2` the run could not answer
      (anything not compared, or an empty declaration set). A team running
      this in CI as a read-only role would otherwise get a red build
      indistinguishable from real drift — and collapsing the two the
      other way, into green, is the silent pass this whole change exists
      to prevent. The precedent is in the script this work ported from:
      `check-declared-vs-catalog.mjs` already exits 2 for "refusing to
      report 0 gaps" and 1 for real ones. The report SHALL say which
      answer it gave and, for `2`, what would make the comparison
      possible. Also make `renderCheckReport`'s inventory argument
      **required**: a defaulted one leaves the 4.4 failure available to
      the next caller, and the inventory is the one section whose absence
      no test can notice. Red: `packages/cli/test/check-command.test.ts`
      — "exits 2 when an object could not be compared", "exits 1 when the
      database disagrees", "exits 0 when everything agreed". Files:
      `packages/cli/src/commands/check.ts`, that test.

## 5. Unmanaged inventory

- [x] 5.1 (~8m) [design] Tables inside the declared schemas that no declaration
      covers, and the extensions the database has, reported as
      information with no effect on the exit code. Existence only — no
      expression, no type, nothing that could produce a false positive.
      The [design] part is the wording and placement of the section: it
      is user-facing text that must read as information, never as a
      failure the exit code forgot to report. **This task ends at the
      report, not at the module** — it adds the extension read, the
      inventory itself, and the lines the command prints, because 4.4
      already showed what a comparison nobody calls is worth. Red:
      `packages/cli/test/check-inventory.test.ts` — "lists an unmanaged
      table and still exits zero", "lists the installed extensions";
      `packages/cli/test/check-command.test.ts` — "prints the inventory
      section in the report". Files:
      `packages/cli/src/check/inventory.ts`,
      `packages/cli/src/check/catalog.ts` (the extension read),
      `packages/cli/src/commands/check.ts` (the section), those tests.

## 6. The live witness

CI has no database, so the comparison above is written to run without
one. This group is the other half: proof that the fixtures describe a
real server. It runs locally, gated on Docker, in the same
split-config shape `packages/pg` already uses.

- [x] 6.1 (~9m) The Docker-gated suite and its config split, so the
      default `pnpm test` run stays free of skipped tests. This group is
      what makes a driver resolvable in this package for the first time,
      which is exactly what could silently disarm the "driver is missing"
      test in 1.2 — that test must still be able to fail **with**
      `@hejbro/pg` installed, or it has stopped testing anything. Confirm
      it, do not assume it. The witnesses come in both forms, because
      each proves something the other cannot. **In-process** for the
      facts that live inside the run — how many check constraints were
      actually compared, that the pinned catalog queries went out
      verbatim, that a limited role produced identical findings — none of
      which a report's text is obliged to expose. **A spawned CLI** for
      the contract that exists only in a process: the three-way exit
      code, and argv reaching the command at all, which is precisely what
      `--url=` slipped through. Spawning needs `@hejbro/pg` resolvable
      from this package — measured: a spawned CLI in this monorepo fails
      with `check-driver-missing` without it, because
      `import("@hejbro/pg")` resolves from the CLI's own location and
      only a user's install has it above them. A devDependency here is
      the honest fix; a symlink is not. Red:
      `packages/cli/test/check-live.integration.test.ts` — "connects to a
      real postgres and reads its catalog". Files: that test,
      `packages/cli/vitest.config.ts`,
      `packages/cli/vitest.integration.config.ts`,
      `packages/cli/package.json`.
- [x] 6.2 (~7m) The zero-false-positive witness: `examples/postgres`'s
      committed chain applied to a real server, and `check` against the
      same declarations reports **no** differences — the claim the whole
      expression design rests on, asserted against the server rather than
      argued. This is also what makes 3.1's query-text pin worth
      anything: the pin fixes the probe's *shape*, and only this witness
      shows the rewrite actually cancels. It therefore asserts **how
      many** expressions it compared — the example declares eight check
      constraints, and a run that silently compared zero would otherwise
      pass. It also fixes the scope of 3.1's other measured claim: that
      Postgres keeps two identical target-list entries rather than
      folding them was observed on postgres:17, so it is established for
      whatever image this witness runs — no further. `pg_get_viewdef`
      changing between 15 and 16 is the standing reminder that deparse
      behaviour is not a constant across majors. Red: same file —
      "reports no differences for the example's own declarations",
      "compares every check constraint the example declares". Files:
      that test.
- [x] 6.3 (~6m) The true-difference witness: alter one column's type on
      the live server and `check` reports exactly that object and exits
      non-zero. Verified load-bearing by asserting the *unaltered* column
      first and watching it fail. Red: same file — "reports the altered
      column, and only it, against a real server". Files: that test.

- [x] 6.4 (~7m) The same database, asked by a role that may only read,
      answers the same. A unit test can only assert the *text* of a
      catalog query; that it is genuinely role-independent is a claim
      about a server, so it is settled against one: connect as a limited
      role and get the same zero differences the owner gets. The owner's
      own default privileges are the trap this catches — a table with no
      explicit grants must not read as a table whose grants went missing.
      **The fixture has to contain that shape** — a table whose `relacl`
      is null and a declaration granting to the owning role — or both
      roles agree on "no grants", the test is green, and the trap it
      exists for walks straight through it. This witness is also what
      backs 1.4's pinned query text, so it checks that the pin and the
      statement actually sent to the server are the same string: a pin
      that has drifted from what runs is worse than no pin, because it
      reads as coverage. Red:
      `packages/cli/test/check-live.integration.test.ts` — "reports the
      same findings as a limited role as it does as the owner", "runs the
      catalog queries 1.4 pinned, verbatim". Files: that test.

## 7. Documentation and release chores

- [x] 7.1 (~7m) `skills/hejbro/references/brownfield-adoption.md`: the
      hand-run two-path `pg_dump` comparison it documents is what this
      command replaces. The skill documents the public surface, so a
      stale skill here is a broken user contract. **No new reference
      file and no change to `SKILL.md`'s references table or frontmatter
      description** — the existing "adopting into an existing database"
      row already routes here, and those are the parts another change in
      flight also edits. Files: that reference.
- [x] 7.2 (~5m) `skills/hejbro/SKILL.md` rule 7 only: it currently says
      `verify` re-derives the chain "from checked-out files only (no live
      DB)" and names no command that does read one, which is exactly the
      gap `check` fills. One line, coordinated separately because this
      file is shared with another change in flight. Files:
      `skills/hejbro/SKILL.md`.
- [x] 7.3 (~6m) Changeset (D59, `minor` — a new capability), task-time
      rows, README badges. **`README.md`'s package table is not
      touched**: its `hejbro` row names three commands as illustration
      and already omits `baseline`, `history` and `restore`, so adding
      `check` there would be the first time that list pretended to be
      exhaustive. `docs/guide/` likewise gained nothing for `baseline`;
      this change follows that precedent rather than setting a new one.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`
      (badges only).
- [x] 7.4 (~9m) `blackbox/` entry (D89): this change carries an
      owner-level decision — the issue asks for `check --schema <dump>`
      and the change deliberately does not build it. What was asked, what
      was measured, what was decided instead, and the reopening
      condition. The owner-request section records the delegation under
      which this change's owner-level calls were made — **in the form
      `blackbox/README.md` prescribes**, which is a faithful English
      rewrite, never word-for-word translation. It names those calls in
      prose (live-connection-only, rejecting the issue's own
      `--schema <dump>` notation on measured grounds; and the driver
      declared as no dependency at all rather than an optional peer) —
      **not** as `D<n>` labels, which belong to the design spec's own
      decision log and would collide. The entry lists what this change
      got **wrong** as plainly as what it got right — a flight recorder
      that only records good flights is not one. That list covers the
      instructions that were wrong, not only the code: the planner's
      replacement grant query, which reintroduced the same false
      "missing" through `aclexplode(NULL)`, and two lead instructions
      the implementer declined to follow blindly — quoting the owner
      verbatim in Korean, against this directory's own rule, and
      labelling decisions `D2`/`D3`, colliding with the design spec's
      global log. Both were caught by asking rather than complying. Two process observations belong in it because they are
      the reason the design is what it is, and neither survives in the
      code: the grant read's *same mistake, opposite direction* (dropping
      a role-filtered view was right, and the replacement silently
      reintroduced the same wrong "missing" through `aclexplode(NULL)`
      until `acldefault` was added), and the order that found it — the
      implementer asking "where would this signal even come from?"
      *before* building the plumbing, which is what exposed the wrong
      data source underneath.

      Three more, all of them things the finished code cannot say about
      itself:
      - **Unit tests here fix a shape; only the live witness fixes a
        meaning.** It happened four times — the catalog query text, the
        probe form, the two `Output` entries, the grant source — and
        each time a mutation that kept the text and broke the meaning
        passed (`acldefault('r')` → `('s')` is the clearest). The
        convention that came out of it: a test whose name claims a
        semantic property must either prove it or say where it is
        proved.
      - **Cutting a comparison short makes the happy test pass harder,
        not easier.** Stubbing the check-constraint walk to return
        nothing left the live "reports no differences" witness green —
        fewer comparisons means fewer findings means a cleaner report.
        Only the witness that asserts *how many* objects were compared
        turned red. A test that checks for the absence of complaints
        cannot notice that nothing was inspected.
      - **A comparison nobody calls is worse than one that is missing.**
        The expression comparison sat fully built and unreachable for a
        group and a half; every test passed and the report simply said
        nothing, which reads as agreement. The task list had named the
        pieces and not the wiring.
      - **The repository predicted its own defect.** `flags.ts` states
        that a fifth value-taking flag which skips its list "silently
        keeps requiring the space form"; `--url` was the fifth, and
        `hejbro check --url=…` answered that no `--url` was given — with
        `DATABASE_URL` set, it would have checked a different database
        and been confident about it. The warning was three years of
        commits away from the code that ignored it.
      Files: `blackbox/2026-08-29-add-check-schema.md`.

## Verification

- Rebase onto `dev` before the first group lands: `dev` moved to
  `8f7d3d1` and carries a gate this change is squarely subject to.
- `pnpm check`, `pnpm check-types`, `pnpm test` clean; `pnpm check:bans`
  clean (#457 — `let`/`var` and every loop statement are refused across
  `packages/*/src` by an AST walk, and every file this change adds lives
  there); `pnpm check:crap` and `pnpm check:tasktime` leave `README.md`
  unchanged (the gate is the diff, not the exit code).
- `.github/workflows/ci.yml` at the reviewed commit is the source of
  truth for what else runs — read it there, do not trust this list.
- `pnpm --filter hejbro test:integration` locally against a real
  postgres:17, with the executed test list and zero skipped shown.
  **Build first.** A stale `dist` makes the suite report `7 skipped` —
  the file still fails and the exit code is still 1, so CI is safe, but
  anyone reading the "Tests" line alone sees skips that are really a
  build-freshness failure. "Skipped 0" is evidence we hand upward, so it
  has to mean what it says.
- Isolated gate runs use `TURBO_FORCE=1` (#448: the turbo cache is shared
  across worktrees and will otherwise replay another worktree's logs).
