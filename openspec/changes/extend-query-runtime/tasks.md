# Tasks: extend-query-runtime

Estimates are pure work minutes. Groups are file-disjoint slices; group 5
is conditional on group 4's measurement and MUST NOT be started before
its outcome is decided.

Conventions that apply to every group:

- The gate set is `pnpm check`, `pnpm check-types`, `pnpm test`,
  `pnpm check:bans`, and `openspec validate extend-query-runtime
  --strict`, all under `TURBO_FORCE=1`. `check:bans` is not optional:
  since the ban list moved out of Biome, it is the only machine check
  for `let` and loop forms.
- A `[design]` task settles a contract, and a contract's shape is half
  types. Every `[design]` task therefore names at least one **type-level**
  mutation alongside its runtime one — a value mutation cannot make a
  widened generic red.
- The task ticks in this file and the rows in `openspec/task-times.csv`
  are written at group boundaries and travel in that group's own commit.

Two facts shape the layout:

- The live-comparison machinery (catalog reader, comparison, inventory)
  stays where it is, in the `hejbro` package. The assertion is a new
  module beside it, reachable from that package's runtime entry, so the
  query layer's single runtime dependency is untouched.
- The capability half only exists if the measurement earns it. Its own
  delta spec is written after group 4, not before.

## 1. The handle keeps what it was built from

- [x] 1.1 (~7m) [design] The handle retains the full declaration list.
      The design part is the retained member's name and shape, and
      whether it joins the public handle type or stays an internal
      assembly surface. The settlement is not complete until both the
      name and the typing are confirmed with the owner; task 1.3 is
      where the settled typing becomes machine-checked, so this task
      stays open until then. Possible outcomes and their Files:
      (a) a new public member on the handle type — Files:
      `packages/query/src/db/db.ts`,
      `packages/query/test/db/db.test.ts`;
      (b) a new field inside the existing declarations record —
      Files: the same two;
      (c) the raw schema module retained as-is under its own member —
      Files: the same two, plus
      `packages/query/test/types/chain-types.test.ts` if the member is
      typed by the schema generic.
      Red: `packages/query/test/db/db.test.ts` — "keeps a declaration
      that is neither a table nor a function". What makes it red:
      delete the retention assignment from the handle literal and the
      enum export is unreachable from the handle.
- [x] 1.2 (~6m) Retention is the module's own values, and classification
      is unchanged. Red: `packages/query/test/db/db.test.ts` —
      "retained declarations are the module's own objects" (identity
      assertions, so a defensive copy fails it) plus tables/functions/
      roles asserted unchanged. What makes it red: map the retained
      entries through a shallow-clone helper and the identity assertion
      fails while every other assertion still passes.
      Files: `packages/query/src/db/db.ts`, that test.
- [x] 1.3 (~6m) The retained member's *type* is pinned, not only its
      value. A widened member is invisible to every runtime assertion,
      and this member exists so the assertion can read declared types
      off it. Red: `packages/query/test/types/chain-types.test.ts` —
      "the handle's retained schema keeps the module's own type". What
      makes it red: widen the member to `Record<string, unknown>` — the
      type assertion fails while all runtime tests stay green.
      Files: that test.
- [x] 1.4 (~5m) The declared-role set is pinned exhaustively, matching
      the delta's "exactly what they were" wording; today only two
      memberships are asserted, so an extra role passes unnoticed. Red:
      `packages/query/test/db/db.test.ts` — the role assertion compares
      the whole sorted set. What makes it red: inject one extra role
      into the classifier.
      Files: `packages/query/src/db/db.ts`, that test.

Gates: the standard set above. Group files:
`packages/query/src/db/db.ts`, `packages/query/test/db/db.test.ts`,
`packages/query/test/types/chain-types.test.ts`.

## 2. The assertion

- [ ] 2.1 (~10m) [design] The public surface. **Settled with the owner**:
      a free function `assertSchema(handle, options?)` resolving to a
      report that keeps compared and uncompared declarations in separate
      places — "not counted as matching" has to be observable, not just
      asserted in prose; `options` carries the registry and the opt-out
      for uncompared declarations; a divergence throws under
      `assert-schema-diverged` and an uncompared declaration under
      `assert-schema-not-compared`, while the per-object findings keep
      the codes the comparison already gives them;
      the findings the comparison already produces travel on the error,
      and their message text is reused, never rewritten. The report's
      own field names are part of this settled surface, not an
      implementation choice made later, and no other task in this group
      may introduce one: the two places are **`compared`** and
      **`notCompared`**, an uncompared entry carrying the identity and
      the reason in the comparison's existing finding vocabulary, a
      compared entry carrying the identity alone. This task lands that
      surface. Red:
      `packages/cli/test/assert-schema.test.ts` (new) — "a matching
      database passes" and "a missing declared table throws naming it",
      both driven by a fixture session returning canned catalog rows.
      What makes it red (runtime): drop the declared table from the
      fixture's catalog rows and the passing case throws. What makes it
      red (type): widen the report's type to `unknown` — the report's
      own type assertion fails while both runtime cases stay green.
      Files: `packages/cli/src/assert-schema.ts` (new), that test.
- [ ] 2.2 (~8m) The failure is one coded diagnostic carrying a finding
      per object with a `Next:` clause — the shape the live-comparison
      machinery already produces, reused rather than re-derived. Red:
      `packages/cli/test/assert-schema.test.ts` — "the thrown error
      carries one finding per diverging object". What makes it red:
      join the findings into a single message string and the per-object
      assertion fails.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [ ] 2.3 (~8m) "Could not answer" is not success: a declaration no
      registry kind owns fails the assertion under its own code, distinct
      from a real divergence's, and the opt-out changes only whether it
      throws — the names stay in what the caller receives either way.
      Red: `packages/cli/test/assert-schema.test.ts` — "an uncompared
      declaration fails under its own code" and "opting out still names
      it". What makes it red: reuse the divergence code for both and the
      first assertion fails; drop the names from the opted-out report and
      the second does.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [ ] 2.4 (~6m) The registry is an explicit parameter defaulting to the
      generic Postgres registry. Red:
      `packages/cli/test/assert-schema.test.ts` — "a preset-registered
      declaration is compared only once the preset registry is
      supplied". What makes it red: hard-code the default registry
      inside the function and the supplied-registry case still reports
      the declaration as not compared.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [ ] 2.5 (~6m) The import-graph guard: the assertion module's
      transitive imports reach no filesystem, process, or command-line
      module. Red: `packages/cli/test/assert-schema-imports.test.ts`
      (new) — "the assertion's module graph is free of filesystem
      access". What makes it red: add `import "node:fs";` to
      `assert-schema.ts` and the walker reports it.
      Files: `packages/cli/src/assert-schema.ts`, that test.
- [ ] 2.6 (~6m) The runtime entry exports it. Red:
      `packages/cli/test/exports.test.ts` — "the runtime entry exposes
      the assertion". What makes it red: remove the re-export line from
      `packages/cli/src/index.ts`.
      Files: `packages/cli/src/index.ts`, that test.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test` (all with
`TURBO_FORCE=1`), `openspec validate extend-query-runtime --strict`.

## 3. The live witness

- [ ] 3.1 (~9m) Against a real postgres:17: the assertion passes on a
      database built from the declarations, then an object is dropped
      directly in the database and the assertion throws naming it. Red:
      `packages/cli/test/assert-schema-live.integration.test.ts` (new)
      — "passes against the applied schema, throws once an object is
      dropped". Load-bearing check: assert it still passes after the
      drop, which must fail.
      Files: that test.

Gates: `pnpm --filter hejbro test:integration` against a real
postgres:17 (Docker), plus `pnpm check`, `pnpm check-types`,
`pnpm test` (all with `TURBO_FORCE=1`).

## 4. The measurement (gate for group 5)

No product code in this group. The rule is fixed before the numbers
exist: the session path, at least 1000 iterations, median and spread
reported, and prepared statements ship only if the improvement exceeds
twice the run-to-run spread **and** is at least 5% of the median.

- [ ] 4.1 (~8m) Prepared-vs-unnamed measurement over the session path:
      the same statement executed as today's unnamed text query and as a
      named prepared statement, N ≥ 1000, median and spread reported,
      the command printed so the run is reproducible. Red:
      `packages/pg/test/prepared-statement.bench.integration.test.ts`
      (new) — "reports a median and a spread for both execution
      shapes", failing while the harness reports neither. What makes it
      red: return a single sample instead of the distribution and the
      spread assertion fails.
      Files: that test.
- [ ] 4.2 (~7m) Compile-cost measurement: recompiling a statement versus
      reusing a cached compile, same reporting shape. Quantifies the
      cost only — no caching surface ships in this change. Red: same
      file — "reports the compile cost per execution". What makes it
      red: measure a single compile instead of the per-execution
      repetition and the per-execution figure collapses to zero.
      Files: that test.
- [ ] 4.3 (~6m) The numbers are recorded with the exact command,
      iteration count, median and spread, and the decision rule is
      applied to them in writing.
      Files: `openspec/changes/extend-query-runtime/measurement.md`
      (new).

Gates: `pnpm --filter @hejbro/pg test:integration` against a real
postgres:17 (Docker), plus `pnpm check`, `pnpm check-types`,
`pnpm test` (all with `TURBO_FORCE=1`).

## 5. The capability — conditional on group 4

Started only if group 4's numbers clear the rule in group 4's header,
and only after that outcome is confirmed. The `driver-contract` delta
spec is written at that point; these tasks are provisional until then.

- [ ] 5.1 (~8m) [design] The capability key's name and its fail-closed
      semantics. Possible outcomes and their Files — every outcome
      touches `packages/query/src/driver/contract.ts` and
      `packages/query/test/driver/contract.test.ts`; additionally:
      (a) one new key on the existing capability union — no further
      files; (b) the key plus a driver-side option describing what is
      prepared — plus `packages/query/src/driver/errors.ts` and
      `packages/query/test/driver/errors.test.ts`.
      Red: `packages/query/test/driver/contract.test.ts` — "a driver
      omitting the new capability does not type-check" and "the
      capability declared false fails closed". What makes it red: give
      the key a default and the omission case compiles.
- [ ] 5.2 (~8m) The conformance kit observes the new capability's
      obligation, so a driver declaring it true without honouring it is
      caught here. Red:
      `packages/query/test/driver/conformance.test.ts` — "a driver that
      declares the capability and does not prepare fails its tier". What
      makes it red: make the kit skip the obligation when the capability
      is true and the non-honouring fixture passes.
      Files: `packages/query/src/testing/driver-conformance.ts`, that
      test.
- [ ] 5.3 (~10m) `@hejbro/pg` prepares statements when the capability is
      declared. Red: `packages/pg/test/driver.test.ts` — "a repeated
      statement is sent with a stable statement name" plus the existing
      passthrough assertions unchanged. What makes it red: drop the name
      from the query object and the repeat assertion fails while every
      current test still passes.
      Files: `packages/pg/src/driver.ts`, that test.
- [ ] 5.4 (~5m) The exhaustive site list — the capability record is
      exhaustive, so exactly these declarations gain exactly one line
      each, and no other edit is made in those packages:
      `packages/supabase/src/driver/*` capability literal (one line),
      `packages/neon/src/*` capability literal (one line). Reviewed by
      diffing those two files and confirming a one-line addition each.
      Files: those two files only.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test` (all with
`TURBO_FORCE=1`), `openspec validate extend-query-runtime --strict`,
`pnpm --filter @hejbro/pg test:integration`.

## 6. Wrap-up

- [ ] 6.1 (~8m) The published surface's documentation: the assertion in
      the query reference, and the capability if group 5 ran. Red: the
      skill's own surface check — the reference names every export the
      runtime entry adds. What makes it red: add the export without the
      reference entry.
      Files: `skills/hejbro/references/query-layer.md`.
- [ ] 6.2 (~6m) Release hygiene: one changeset (`minor`), the task-time
      rows, the README badges.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`.

Gates: `pnpm check`, `pnpm check-types`, `pnpm test`,
`pnpm check:crap`, `pnpm check:tasktime` (all with `TURBO_FORCE=1`),
`openspec validate extend-query-runtime --strict`, and
`git status --porcelain` shown verbatim after the last two.

## Totals

Groups 1–4 and 6: 16 tasks (4 + 6 + 1 + 3 + 2). Group 5 adds 4 more if
the measurement earns it.
