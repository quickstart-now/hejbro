# Tasks: harden-reset-and-verify

Two groups, no file overlap. Every task is test-first (red, minimal
green, refactor). Estimates are pure work minutes (D88).

**Group 1** touches `packages/core`'s diff engine and table kind, plus
`packages/cli/src/apply/reset.ts`. **Group 2** touches
`packages/cli/src/commands/verify.ts` and `packages/cli/package.json`
(a new devDependency). Neither group edits a file the other owns.

## 1. `reset` drops in dependency order and reports a failed drop

- [x] 1.1 (~8m) **[design]** A new, optional `ObjectKind` extension
      member — settle its name (`dependsOnIdentities` is this task's own
      proposal, mirroring `ownerTableIdentity`'s `<subject>Identities`
      shape) and signature: `(node: JsonValue) => ReadonlyArray<string>`,
      returning the identities of *other objects of the same kind* the
      given node depends on existing. Only `tableKind` implements it —
      every other kind's cross-object dependency is already expressed at
      the kind level via `dependsOn` (a view, a policy, a trigger, a
      sequence all name `table` in their own `dependsOn`), so no other
      kind has a same-kind edge to report. Settle two more details: a
      table's own identity is excluded from its own result (a
      self-referencing foreign key is not an edge to sort against), and
      two foreign keys naming the same target table collapse to one
      identity. Red: `packages/core/test/table-kind-diff.test.ts`, new
      case *"dependsOnIdentities names a table's own foreign-key
      targets"*, driven by an input table spanning "a table's own
      dependencies": no foreign key (empty); one foreign key to another
      table (that table's identity); two foreign keys to two different
      tables (both, in declaration order); two foreign keys both
      targeting the same table (one identity, not two); a
      self-referencing foreign key, e.g. `parent_id references
      self(id)` (excluded — empty); a composite, multi-column foreign
      key (still one identity, not one per column). Files:
      `packages/core/src/kind/object-kind.ts`,
      `packages/core/src/kinds/table-kind.ts`,
      `packages/core/test/table-kind-diff.test.ts`.

      Note: "two foreign keys to two different tables (both, in
      declaration order)" landed corrected — `table-kind.ts`'s own
      `serializeForeignKeys` already sorts `foreignKeys` by D1's column
      comparator before `dependsOnIdentities` ever sees them, so the
      order a `dependsOnIdentities` result carries is that sorted order,
      not the order the DSL's `table()` call wrote them in. Not a design
      change — the test's own expected value, corrected to match.

- [x] 1.2 (~10m) **[design]** `diffSnapshots` applies `dependsOnIdentities`
      as a stable, intra-kind topological refinement of the order it
      already computes — settle three details. First, scope: apply it to
      *both* the create and the drop groups (not drop alone) for the same
      reasoning `rankKinds` already applies at the kind level
      (dependencies before dependents on create, the reverse on drop) —
      cost-free today, since every foreign key's `add constraint` is
      already emitted on the `deferred` stage, after every table's
      `create table`, but defensive against a future kind whose create
      statement is not so decoupled. Second, an edge naming an identity
      *outside this diff's own same-kind change set* (a table that is not
      itself being created or dropped in this run) is ignored — an
      ordinary, unrelated reference, not a constraint on this run's
      order. Third, a genuine cycle among the kind's own changes in this
      diff (two tables each referencing the other, both being dropped or
      both being created) — **never throws**: the topological refinement
      leaves a cycle's members in their existing (identity) order, both
      directions, since neither order satisfies the cycle and a mutual
      foreign key is a legal pair to create (its `add constraint`
      statements both land on `deferred`, after both tables exist). A
      drop the database then genuinely refuses surfaces through 1.4's
      coded failure, not a diff-time throw — a diff-time refusal would be
      a regression against today's legal create of two mutually
      referencing tables. Confirm the existing per-kind identity order
      survives as the stable tie-break wherever the graph does not
      further constrain it, including inside a cycle. Red:
      `packages/core/test/diff-engine.test.ts`, new describe block
      *"diffSnapshots — same-kind dependency ordering"*, driven by an
      input table: a referencing/referenced pair whose names sort with
      the referenced table first alphabetically (drop orders the
      referencing table first anyway; create orders the referenced table
      first — the same pair, opposite operation, opposite-direction
      assertion — this is the shape #753 itself reported); the same kind
      of pair but where the referencing table's name *already* sorts
      first alphabetically (the refinement must leave this order alone,
      not reverse an already-correct one); a three-table chain
      (grandparent/parent/child), fully ordered in both directions; a
      table referencing two independent tables with no edge between them
      (only "referencing before both" is asserted, never the two
      independents' relative order); a genuine two-table cycle, both
      operations (drop and create each keep the pair in its existing
      identity order, no throw); a foreign key to a table *outside* this
      diff (ignored, ordinary identity order); and the existing "sorts by
      identity (byte order) within the same kind" case re-run unchanged
      (no foreign key between `alpha` and `zebra` — this is a regression
      pin, not a new row). Files: `packages/core/src/engine/diff-engine.ts`,
      `packages/core/test/diff-engine.test.ts`.

- [x] 1.3 (~5m) A regression witness that this change leaves the
      already-correct *cross-kind* order alone — the dependency graph
      this proposal names (foreign keys, a view's or a policy's or a
      trigger's own table, a trigger's own function, a sequence's owning
      table) is wider than the one real gap 1.1/1.2 close, and the wider
      list is exactly what a reviewer should be able to find pinned. Red:
      `packages/core/test/diff-engine.test.ts`, new case *"a schema, a
      table, its sequence-backed column, a trigger, an RLS policy, and a
      view all drop before the schema, and the view/trigger/policy all
      drop before the table"* — one combined fixture (no table-to-table
      foreign key involved), asserting the drop order's kind sequence
      matches `rankKinds`' own computed order rather than a hand-copied
      literal, so the pin tracks the real dependency graph instead of
      restating today's incidental array order. Files:
      `packages/core/test/diff-engine.test.ts`.

- [x] 1.4 (~8m) **[design]** `applyReset`'s transaction failure is
      translated into a coded `reset-drop-failed` `HejbroError` instead of
      escaping uncaught — settle the message wording (draft: `` hejbro
      reset failed to drop your declared objects${codeSuffix(code)}:
      ${reason}. The transaction was rolled back — nothing was dropped and
      the ledger is unchanged. Next: run `hejbro status` to confirm,
      resolve what the error above describes (an object outside your
      declarations may still depend on one you're dropping), then rerun
      `hejbro reset`. ``), reusing `apply/execute.ts`'s existing
      `driverErrorCode`/`driverErrorReason`/`codeSuffix` (already exported
      for exactly this reuse; `raise.ts` does the same). Red:
      `packages/cli/test/apply-reset.test.ts`, new case *"a failed drop is
      reported as a coded error, not an uncaught crash"*, driven by an
      input table over what the fake driver's `transaction` callback
      throws: an object carrying both `.code` and `.message` (assert the
      code suffix and the message both appear); an `Error` with a
      `.message` but no `.code` (assert the reason still surfaces, no
      code suffix); a bare non-`Error` thrown value, e.g. a string (assert
      `applyReset` still rejects with a `HejbroError`, never the raw
      value). Every row asserts `error instanceof HejbroError`,
      `error.code === "reset-drop-failed"`, and that the ledger the fake
      driver recorded is untouched (the confirmation/declarations-empty
      preconditions above this transaction stay HejbroErrors already and
      are unaffected). Files: `packages/cli/src/apply/reset.ts`,
      `packages/cli/test/apply-reset.test.ts`.

- [x] 1.5 (~9m) A real-Postgres witness (Docker), mirroring
      `live-witness.integration.test.ts`'s own image selection
      (`HEJBRO_PG_IMAGE`, default `postgres:17-alpine`) and its
      docker-availability gating (skipped when `docker info` fails) —
      that file's own matrix, not a separate PG 15/17 pair. Two cases
      against one running container: (a)
      a `lab` schema holding `lab.projects` and `lab.tasks (tenant_id,
      project_id) references lab.projects (tenant_id, id)`, migrated,
      then `hejbro reset --confirm-drop <db>:<n>` — asserts exit 0, all
      three objects gone from the catalog, and `hejbro status` afterward
      reports the chain pending from its start; (b) the same schema
      reapplied, then a table outside hejbro's own declarations created
      by hand with its own foreign key into `lab.projects` (standing for
      "something hejbro does not manage still depends on what is being
      dropped") — asserts a second `reset --confirm-drop` fails even
      under the corrected order, reports the coded `reset-drop-failed`
      error, exits non-zero, and `hejbro status` afterward still shows
      every migration applied (the database and the ledger unchanged).
      Files: `packages/cli/test/apply-reset.integration.test.ts` (new;
      `packages/cli/test/docker-volumes.ts` reused, not edited). Single
      image, not a PG 15/17 pair (the drop-order fix is dialect-independent
      SQL; the witness file states this).

      Ran green against a real container: both cases executed, none
      skipped by the docker gate.

## 2. `verify` runs registered preset validators as a sixth check

- [x] 2.1 (~9m) **[design]** `verify`'s existing declarations-vs-snapshot
      check never receives the registered validators — an omitted
      argument on its own `generateMigration` call, which is the whole of
      #752's root cause. Settle the refactor's shape: one
      `generateMigration({ ..., validators })` call, its rendered-snapshot
      comparison feeding the existing check unchanged and its `.errors`
      feeding a new, independent sixth check — never two separate
      `generateMigration` calls computing the same pipeline twice. Adds
      `@hejbro/nile` as a `packages/cli` devDependency, resolved by a test
      fixture through a `node_modules` symlink to its built `dist` —
      corrected during review (R57's own draft wrongly called this a
      vitest source alias; only `@hejbro/core`/`@hejbro/query` are
      source-aliased, and `@hejbro/supabase` already resolves this same,
      symlinked way) — so the sixth check's own fixtures can use the
      issue's own reported example. Red:
      `packages/cli/test/verify.test.ts`, new case *"a preset-refused
      declaration fails verify with generate's own error"*, driven by an
      input table: a `nilePreset`-registered tenant-aware table whose
      primary key omits `tenant_id` (`nile-tenant-primary-key-missing`,
      the issue's own reported example); an existing `@hejbro/supabase`
      preset refusal; the identical declaration with no preset registered
      (verify passes — nothing refuses it); a declaration every
      registered validator accepts (verify passes); no preset registered
      at all (today's behavior, unaffected — the report never mentions a
      preset check). Files: `packages/cli/src/commands/verify.ts`,
      `packages/cli/package.json`.

- [x] 2.2 (~8m) **[design]** The new check's own report shape: absent
      (not a `skipped:` line — there is nothing to skip) from the total
      and the report when no preset is registered; when more than one
      registered validator refuses in the same run, **every** refusal is
      reported, each with the same code and message `generate` itself
      would print for it — never only the first, since the "generate and
      verify agree" scenario has to hold for a multi-refusal run too, not
      only a single-refusal one. This is a genuine difference from every
      other check in this file (`runCheckDuplicateVersion` included,
      which does report only its first group): settle the shape change
      this forces — the preset check's own outcome carries a list of
      errors rather than the single `error` every other `CheckOutcome`
      carries, and each becomes its own diagnostic in the batch `verify`
      already renders, rather than being folded into one. Extend the
      existing `totalChecks`/`BASE_CHECKS` counting so the preset check
      still counts as exactly **one** check (pass/fail), independent of
      how many refusals it reports, and independent of the export check
      (a run can carry zero, one, or both). Red:
      `packages/cli/test/verify.test.ts`, golden-line cases: `"verify: 6
      checks passed"` when a preset is registered and nothing is refused;
      `"verify: 5 checks passed"` unchanged when no preset is registered
      (an existing golden line, re-pinned as a regression); `"verify: 7
      checks passed"` when both the export check and the preset check
      apply in the same run; two declarations that two different
      registered validators each refuse in the same run report **both**
      diagnostics, each with its own coded message, and the check still
      counts as one failed check, not two. Files:
      `packages/cli/src/commands/verify.ts`,
      `packages/cli/test/verify.test.ts`.

- [x] 2.3 (~6m) A cross-command parity witness: the identical refused
      declaration produces the identical coded error from both `hejbro
      generate` and `hejbro verify` — the acceptance criterion #752
      itself states. Red: `packages/cli/test/verify.test.ts`, new case
      running both commands (`runCli`) against the same fixture used in
      2.1 and asserting the diagnostic's code and message text agree
      between the two reports (never their surrounding `verify:`/
      `generate:` summary line, which differs by design). Files:
      `packages/cli/test/verify.test.ts`.

      Note: `packages/cli/test/support/cli-runner.ts` also needed a
      `node_modules/@hejbro/nile` fixture symlink (mirroring the existing
      `@hejbro/supabase` one) for a jiti-loaded fixture to resolve
      `import { nilePreset } from "@hejbro/nile"` for real — not named in
      2.1's own file list, an enabling-infrastructure addition of the
      same shape the supabase symlink already established, not a
      contract change (lead-approved during review). Review also found
      that `verify.ts`'s own `identityFromMessage` lacks `generate.ts`'s
      adjacent-quoted-pair handling, so two different tables refused in
      the same run both print `: app` in their diagnostic header — closed
      in group 3 below, task 3.1, rather than left as a follow-up: the
      confusion is directly in the surface this task itself just started
      exercising for the first time (verify's report never carried a
      preset-validator's own message, with its adjacent-quoted identity,
      before this group).

## 3. Review repairs (group 2's reviewer findings)

- [x] 3.1 (~5m) `verify`'s own diagnostic construction reuses the shared
      `../identity.ts` helper `generate.ts` already uses, replacing the
      local, now-stale copy in `verify.ts` (whose own comment claims
      parity with `generate.ts` that no longer holds) — so an
      adjacent-quoted-pair identity (`"app"."items"`) resolves to
      `app.items`, not `app`, and two different tables refused in the
      same run are told apart by their diagnostic headers instead of
      both printing `: app`. Its `at` line also becomes cwd-relative, the
      same way `generate.ts`'s own `toDiagnostic(error, fallbackIdentity,
      cwd)` already renders it, instead of the machine's own absolute
      path. Red: `packages/cli/test/verify.test.ts`, tighten the
      multi-refusal case 2.2 already added (two different tables, two
      different registered validators refusing in one run) to assert
      each diagnostic's own identity/`at` line differs and names its own
      table, and that neither carries an absolute filesystem path. Files:
      `packages/cli/src/commands/verify.ts`,
      `packages/cli/test/verify.test.ts`.

- [x] 3.2 (~5m) `skills/hejbro`'s own reference doc is corrected to match
      observed behavior: `references/generate-verify-workflow.md`
      currently states "Five checks" and "There is no sixth check and no
      database-inspecting option", both no longer true (the export check
      already made the count variable before this change; the preset
      check adds a second, independent way it varies). Describe the true
      shape: five checks always run, plus the export-freshness check when
      the export is enabled, plus the preset-validator check when the
      active configuration registers a validator — up to seven. Files:
      `skills/hejbro/references/generate-verify-workflow.md`.

- [x] 3.3 (~3m) `@hejbro/nile`'s fixture symlink gets the same
      build-freshness guard `assertBuiltCli` already runs for
      `@hejbro/core`/`hejbro` — a stale `packages/nile/dist` would
      otherwise let `verify`'s new sixth-check fixtures silently exercise
      old nile validator code. Red: none available (this pins a guard
      against a state the suite cannot presently construct); state the
      mutant instead — an intentionally stale `packages/nile/dist` must
      make `assertBuiltCli` refuse before any test using the nile fixture
      runs, restored immediately after (`git checkout --`/rebuild, never
      committed). Files: `packages/cli/test/support/cli-runner.ts`.

- [x] 3.4 (~5m) The four symbols 3.1 just copied into `verify.ts`
      (`FILE_URL_PREFIX`, `stripFileUrlPrefix`, `relativizeLocation`,
      `relativizeDeclaredAt`) are byte-identical to `generate.ts`'s own —
      reviewer-found: 3.1 exists because a *previous* local copy
      (`identityFromMessage`) silently drifted from its own claimed
      parity with `generate.ts`, and leaving a second, differently-named
      local copy in place recreates exactly that trap. Move all four into
      the shared `../identity.ts` (already the home `3.1` itself pulled
      `identityFromMessage`'s replacement from), and have both
      `generate.ts` and `verify.ts` import them from there — no behavior
      change, so the existing golden/parity assertions are the
      regression coverage; no new test is added for a pure move. Files:
      `packages/cli/src/identity.ts`, `packages/cli/src/commands/verify.ts`,
      `packages/cli/src/commands/generate.ts`.

- [x] 3.5 (~2m) `generate-verify-workflow.md`'s own new sentence
      (3.2) says the preset check applies "when the active config
      registers at least one preset" — imprecise against the spec and
      the implementation, both of which key on a **validator**, not a
      preset (a kinds-only preset with no validator still reports five
      checks, reviewer-measured). Correct the one word: "registers at
      least one preset validator". Files:
      `skills/hejbro/references/generate-verify-workflow.md`.

- [x] 3.6 (~3m) `@hejbro/supabase`'s fixture symlink gets the same
      build-freshness guard 3.3 gave `@hejbro/nile` — `verify.test.ts`'s
      own existing supabase-preset-refusal case is exactly the same risk
      shape (a signal read from `packages/supabase/dist`), now
      asymmetric against nile's freshly-guarded one. Same mutant proof as
      3.3: an intentionally stale `packages/supabase/dist` must make
      `assertBuiltCli` refuse, restored immediately after. Files:
      `packages/cli/test/support/cli-runner.ts`.

- [x] 3.7 (~2m) `docs/guide/ci.md`'s own "exits `0` when all five checks
      pass" line is corrected to state the count varies (five, plus the
      export check when enabled, plus the preset-validator check when
      one is registered — the same fact 3.2 already states in
      `generate-verify-workflow.md`); the line's own example output (`1
      of 5 checks failed`) is untouched, since it is already scoped to a
      project with neither. Files: `docs/guide/ci.md`.

- [ ] 3.8 (~5m) `applyReset`'s own catch re-codes **every** failure the
      transaction raises as `reset-drop-failed`, including a `HejbroError`
      the transaction itself already coded — so
      `reset-migration-not-singular` (raised inside the transaction, its
      code documented alongside the ledger it guards) can never reach a
      user, and its message is dressed in advice about objects outside
      the declarations that does not apply to it. Preferred fix: hoist
      the migration-SQL computation out of the transaction callback — it
      is a pure computation, and hoisting it also means the guard refuses
      before any statement is sent. Where that is not possible, the catch
      instead rethrows a `HejbroError` unchanged and wraps only a failure
      that is not one. Red:
      `packages/cli/test/apply-reset.test.ts`, new case *"a hejbro-coded
      failure inside the transaction keeps its own code"*, over an input
      table of what the transaction raises: a `HejbroError`
      (`reset-migration-not-singular`) — its own code survives; a driver
      error object with `.code`/`.message` — still `reset-drop-failed`
      (1.4's rows, re-run as the regression pin); a bare non-`Error`
      value — still `reset-drop-failed`. Files:
      `packages/cli/src/apply/reset.ts`,
      `packages/cli/test/apply-reset.test.ts`.

- [ ] 3.9 (~6m) The create-side ordering change moves the committed
      example migrations too, not only `packages/core`'s goldens:
      `examples/postgres` and `examples/supabase`'s chain tests
      ("regenerating … reproduces the committed migrations") both fail
      against the new order. Regenerate the committed migrations and show
      — the same way the goldens are shown — that the regenerated files
      differ from the committed ones **only** in statement order, with no
      statement added, removed or reworded, and that each chain's own
      banner hashes still verify afterwards. Files:
      `examples/postgres/migrations/*`, `examples/supabase/migrations/*`
      (regenerated, not hand-edited).

- [ ] 3.10 (~6m) The delta's cycle sentence — two declared tables that
      reference each other drop in their existing identity order, and the
      refusal the database then raises is reported through the coded
      failure — has no real-Postgres witness: the unit rows fake the
      driver, and 1.5's two cases are an ordered pair and an
      outside-the-declarations dependant. Add a third case to
      `packages/cli/test/apply-reset.integration.test.ts`, against the
      same container and the same gating: a mutually referencing pair
      migrated successfully (creation is legal), then `reset
      --confirm-drop` — asserts a non-zero exit, `reset-drop-failed`
      carrying the database's own `2BP01` reason, both tables still
      standing, and `hejbro status` afterward still reporting the
      migration applied. Files:
      `packages/cli/test/apply-reset.integration.test.ts`.

- [ ] 3.11 (~9m) **[design]** A migration's name follows the order the
      run emits, because the slug is taken from the first entry of the
      same array the dependency refinement permutes — so refining the
      emitted order renames a committed migration (measured: a step that
      creates one table and alters another changes its own file name).
      The name SHALL instead be derived from the change list as it stands
      *before* the refinement: kind order, then identity. Settle where
      that happens — the refinement only permutes within contiguous
      same-kind runs, so re-sorting each such run by identity inside the
      slug derivation reproduces the pre-refinement order without
      threading a second array through the generation pipeline; prefer
      that over widening the generated-migration type. Red:
      `packages/core/test/diff-engine.test.ts` (or the slug's own test
      file), new case *"the dependency refinement does not change a
      migration's slug"*, over an input table: a run whose first change
      the refinement moves (create one table, alter another that
      references it); a run the refinement leaves alone (regression pin);
      a drop-only run whose first change the refinement moves; and a run
      whose moved first change is an `alter`, not a `create` — the
      refinement groups creates and alters together, so an alter-only
      run can move the slug too. `examples/{postgres,supabase}`'s chain tests, green
      with their committed file names unchanged, are the second witness.
      Files: `packages/core/src/sql/migration-file.ts`,
      `packages/core/src/engine/diff-engine.ts` (only if the derivation
      needs the kind grouping), and their tests.

## Close-out (not a group)

The changeset, `openspec/task-times.csv`, the README stamps
(`pnpm check:tasktime`, `pnpm check:crap`), and `skills/hejbro`'s own
extension-interface reference (task 1.1 adds a public `ObjectKind`
member, the same category `ownerTableIdentity` already documents there —
task 3.2 above is the *count*-shaped doc fix verify's own review found,
a separate correction in the same file) land in one close-out commit at
PR time.
