# Tasks: harden-adoption

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/engine/diff-engine.ts`,
`packages/core/src/kinds/table-kind*.ts`, `packages/core/src/kinds/
sequence-kind.ts`, `packages/core/src/kind/object-kind.ts` (the change
shape, if a transition flag is needed) and their tests plus goldens
(1.1, 1.2); `packages/cli/src/commands/generate.ts` and its tests (1.3);
`packages/cli/test/*.integration.test.ts` (1.4); `skills/hejbro/
references/brownfield-adoption.md`, `skills/hejbro/references/
extension-interface.md` (the public `KindChange` surface gains an
optional field, 671/R4), one `.changeset/*.md` (1.5). If a
task appears to need any other file, that goes back to the planner, not
into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5.

## 1. Adoption

- [x] 1.1 (~10m) **[design]** The table's children on adoption. Settles
      how the diff engine tells a kind "this owner was adopted" (a
      transition on the `KindChange`, or a separate create per child
      derived from the table diff). Red: the table-kind diff/emit tests,
      an input table over {index, check, foreign key, primary key} ×
      {adoption → created; handover → nothing; managed unchanged →
      nothing; new table → inside `create table` as today}. Files:
      `diff-engine.ts`, `table-kind*.ts`, tests, goldens.

- [x] 1.2 (~9m) The adopted sequence. Red: sequence-kind tests — for an
      adopted owner, `create sequence if not exists …;` then `alter
      sequence … as <type>;` and `alter sequence … owned by …;`; for a
      new table, the plain `create sequence` unchanged (a golden pins
      it); a handover then adoption round trip in the engine tests
      yields the idempotent form. Files: `sequence-kind.ts`,
      `diff-engine.ts`, tests, goldens.

- [x] 1.3 (~7m) **[design]** `adoption-creates`. Settles the message.
      Red: the generate command tests — adoption prints one line per
      adopted table naming each created object kind and the `baseline`
      Next; handover and a new table print nothing; the migration is
      written either way. Files: `generate.ts`, tests.

- [x] 1.3a (~8m) The missing-column risk (review round 1, B1/N4).
      Red: the generate command tests — an input table over {index,
      check, foreign key} × {the existing declaration carries the
      column; it does not}, both created either way, the notice
      carrying its second risk sentence and the `check --url` and
      `baseline` branches of `Next:`; and an adopted table with a new
      not-null column prints no column-level warning while a managed
      one still does. Files: `generate.ts`, tests,
      `brownfield-adoption.md`.

- [x] 1.4 (~9m) Live witnesses on `postgres:17-alpine`. (C-1) A
      declaration whose only managed object is a `serial` sequence:
      managed → handover (sequence kept) → adoption applies cleanly
      (`42P07` gone) and `check` reports no differences. (C-2) A bare
      table created with `psql`, declared `existingTable()` then adopted
      as `table()` with an index, a check, a foreign key and a primary
      key: the four children exist in the catalog afterwards and `check`
      reports no differences. Files: the integration test.

- [x] 1.5 (~5m) Docs and changeset. `brownfield-adoption.md` states the
      adoption contract (creates children and normalizes sequences,
      never drops) and the notice, citing the literal
      `warning[adoption-creates]` beside the existing
      `error[baseline-not-first]` (671/R3); `extension-interface.md`
      states the optional `transition` field on `KindChange` (671/R4);
      `pnpm changeset` → `minor`. Files: the two references,
      `.changeset/*.md`.

## 2. D106 round 1 corrections (evaluation.md B1, B2, N4, N8)

One group, one team, sequential; lands on `fix-adoption-d106-r1` as
its own PR with a `patch` changeset. Task 1.3a above shipped in PR
#1019 (13b0c9d5) and is ticked here. **Files edited**:
`packages/core/src/engine/diff-engine.ts`, `packages/core/src/kinds/
table-kind*.ts` and their tests plus goldens (2.1); `packages/cli/src/
commands/generate.ts` and its tests, `packages/cli/test/
*.integration.test.ts` (2.1, 2.2, 2.3); `openspec/changes/
harden-adoption/specs/{table-declaration,cli-commands}/spec.md` (2.2,
2.3); `skills/hejbro/references/brownfield-adoption.md` (2.2, 2.3);
one `.changeset/*.md`, `openspec/task-times.csv` (2.3). Anything else
goes back to the planner. Commit condition, serial: `TURBO_FORCE=1
pnpm check` first, then `check-types`, `test`, `check:crap`; report
exit codes and the SHA.

**Ordering.** 2.1 → 2.2 → 2.3.

- [x] 2.1 (~10m) B1 — the primary key is created on adoption whatever
      the existing declaration listed (671/R9). Red: diff-engine /
      table-kind tests over an input table {the existing declaration
      listed the PK; it did not} × {the table has other children to
      create; it has none}: every cell whose managed
      declaration carries a PK emits `alter table … add constraint
      "<t>_pkey" primary key (…)` on the existing → managed transition,
      including the cell that used to adopt silently (a PK on both
      sides and nothing else): it now creates the PK and
      `adoption-creates` names it, which is what the delta's "every …
      primary key the declaration carries is created" says. The FK
      cell already behaves this way and is the control. Green: the
      table kind's adoption branch treats the PK like its other
      children — the existing side's snapshot never suppresses a
      create. Live witness: the review's `p2-children` `posts` replay
      (`/private/tmp/d106-ha/p2-children`, PK listed on both sides,
      two indexes, a check, two FKs) applies with the PK in the
      catalog and `check` reports a difference only on R6's own column-
      default line (671/R6, N1: a `serial` column's `nextval` default is
      never attached on adoption, by design) — zero lines for the index,
      the check, the foreign keys or the primary key. Mutation: restoring
      the existing-side suppression reddens exactly the listed-PK
      cells. Files: core engine/kind, tests, goldens, generate tests.

- [x] 2.2 (~10m) **[design]** B2 — a `Next:` first branch that runs on
      the database it describes (671/R10). Measure first, then settle:
      on the review's `p3b-children-roundtrip` state (managed → handed
      over → re-adopted, database holding every object), does `hejbro
      migrate` register the re-adoption migration without running it
      when that migration carries the baseline marker (migration-apply,
      *A baseline is registered rather than run*: "A migration carrying
      the baseline marker … SHALL record it in the ledger with the
      `registered` origin, without executing its statements")? Report
      the measured answer to the lead before writing text. Branch (a),
      it registers: the `Next:` first branch names that path in the
      words the skill will document, the scenario sentence "`hejbro
      baseline` records what the database already holds" becomes the
      measured sentence, and the reference's two contradictory
      paragraphs are rewritten as one. Branch (b), it does not: the
      `Next:` first branch says to keep the table handed over (restore
      the migration, the snapshot and the declaration this run wrote —
      three files, not the second branch's two) or to drop the held
      objects and apply, the scenario sentence says exactly that, and a
      follow-up issue under #995 asks for a mid-chain "register what
      the database already holds" path. Red either way: the generate
      command tests pin the new `Next:` text; a live witness follows
      the first branch literally on `p3b` to a `check` with no
      differences and a ledger row for the drop path, pending 0 for the
      revert path. Files: `generate.ts`, tests, the two
      delta specs, `brownfield-adoption.md`.

- [x] 2.3 (~5m) Text, ledger, changeset. N4: the notice's first
      sentence names only the objects a held copy makes fail (index,
      check, foreign key, primary key) — a held sequence is reused, RLS
      enablement and policies are idempotent — pinned by the generate
      tests. N8: the delta scenario writes `existingTable("app",
      "widgets", …)`. Tick 1.3a. `pnpm changeset` → `patch`; one ledger
      row per task; README badges. Files: `generate.ts`, tests, the
      delta specs, `.changeset/*.md`, `task-times.csv`, `README.md`.
      N4/N8 landed with 2.2's own text rewrite (671/R10 forced the same
      lines). Folded in from the reviewer's own round 1 findings on 2.1
      (owner-ratified, not originally scoped): F1, a narrowed silent
      cell (an adoption with zero declared children, no primary key
      anywhere) had lost its only guard when the PK-only cell it used to
      share a test with was rewritten to assert the create instead —
      pinned again, core and CLI, plus a CLI PK-only cell naming the
      guard's own CLI-surface control. F3, the banner's own notes never
      named a primary-key-only adoption's create (`-- ~ table …`, no
      bracket at all, next to a file that carries `add constraint …
      primary key`) — fixed condition-scoped to adoption with nothing
      else to note, so a
      managed→managed primary key move (already a `column "…" changed`
      note) and a new table's inline primary key never gain a second,
      duplicate note. F5-2, an 18-line derivation comment trimmed to its
      one trap sentence.
