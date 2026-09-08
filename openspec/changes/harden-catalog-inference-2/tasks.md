# Tasks: harden-catalog-inference-2

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). This change's input is a catalog reading, so the
piece reviewer runs in constructor mode (D110).

**Files edited**: `packages/cli/src/check/catalog.ts`, `packages/cli/
src/infer/rest.ts` and tests (1.1); `packages/cli/src/infer/rest.ts`,
`packages/cli/src/infer/compose.ts`, `packages/cli/src/infer/
loss-report.ts` and tests (1.2); `packages/cli/src/infer/compose.ts`,
`packages/cli/src/infer/loss-report.ts`, a shared comparator module,
`packages/cli/src/commands/check.ts` (the comparator moves out of it;
nothing else) and `packages/cli/src/declare-emit/emit.ts` (its two
sorts only) (1.3, 1.4); `packages/cli/test/infer-*.integration.test.ts`
(1.5); `skills/hejbro/
references/brownfield-adoption.md`, one
`.changeset/*.md` (1.6). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1, 1.2, 1.3 and 1.4 are independent; 1.5 after all;
1.6 last.

## 1. Catalog inference

- [x] 1.1 (~7m) Roles from policies. Red: the infer tests over a fake
      catalog with a `policies` rows table {`to app_reader` only in a
      policy; `to public`; `to {a,b}` (two roles on one policy); a grant
      to `public`} → roles `a`, `app_reader`, `b`, plus the grant
      roles, never `public`. Green: the policies query selects `roles`;
      `inferRoleNames` unions them and drops `public`. Files:
      `catalog.ts`, `rest.ts`, tests.

- [x] 1.2 (~10m) **[design]** Enum names under D36. Settles the
      omission's data shape (an `OmittedEnum` carrying the enum and
      the columns typed by it) and the report line. Red: compose/loss
      tests over an input table of enum names {`Status`, `my-enum`,
      `2nd`, `_x` (passes the round trip, fails the rule), `status`
      (kept)} × {a column typed by it in the same schema; in another
      schema; none} → the enum and every column typed by it omitted, no
      surviving reference, one report line naming enum and columns with
      the `check` consequence; `status` and its column kept. Files:
      `rest.ts`, `compose.ts`, `loss-report.ts`, tests.

- [x] 1.3 (~8m) Foreign keys at an omitted column, and the primary-key
      name. Red: compose/loss tests — {FK from an omitted column; FK
      into an omitted column; both ends fine} → the first two omitted
      and named with the column, the starter loads (`loadDeclarations`
      over the written text); {PK named `pk_orders` → derived
      `orders_pkey` + a report line with both ways out; PK with the
      derived name → no line}. Files: `compose.ts`, `loss-report.ts`,
      tests.

- [x] 1.4 (~5m) One comparator. Red: the loss-report tests — an NFC/NFD
      pair and two names a locale reorders sort by code points under
      `LC_ALL=C` and `LC_ALL=en_US.UTF-8` alike; `sortedBy` imports the
      inventory's comparator from one shared module. Files:
      `loss-report.ts`, the shared module, tests.

- [x] 1.5 (~8m) Live witness on `postgres:17-alpine`: a database with
      `create type app."Status"`, a column of that type, a policy `to
      app_reader` — `hejbro import` writes declarations without the
      enum or its column, names both in the report, and the description
      carries `app_reader`; `hejbro check` afterwards lists the column
      as unmanaged and does not name the enum type. Files: the
      integration test.

- [x] 1.6 (~5m) Docs and changeset. The brownfield reference's loss
      list gains the enum and primary-key-name lines and the roles
      sentence says "grants and policies"; `pnpm changeset` → `patch`.
      Files: the reference, `.changeset/*.md`.

## 2. D106 round 1 corrections (evaluation.md B1, B2, N2, N5, N8, N11 + docs N1, N4, N6, N9, N10)

One group, one team, sequential; lands on
`fix-catalog-inference-2-d106-r1` as its own PR with a `patch`
changeset. The reviewer is summoned in constructor mode (the input is a
catalog, D110). **Files edited**: `packages/cli/src/infer/*` and its
tests, `packages/cli/src/contract/from-catalog.ts` if the pulled
contract's Insert/Update shapes need the generated family (2.1);
`packages/cli/src/infer/loss-report.ts`, `packages/cli/src/commands/
pull.ts`, `packages/cli/src/commands/import.ts` and their tests,
`openspec/changes/harden-catalog-inference-2/specs/catalog-inference/
spec.md` (2.2); `skills/hejbro/references/brownfield-adoption.md`, one
`.changeset/*.md`, `openspec/task-times.csv` (2.3). Anything else goes
back to the planner. Commit condition, serial: `TURBO_FORCE=1 pnpm
check` first, then `check-types`, `test`, `check:crap`; report exit
codes and the SHA.

**Ordering.** 2.1 → 2.2 → 2.3.

- [x] 2.1 (~10m) B1 / #1022 — a generated column is read as generated
      (712/R11). Red: the infer tests over a fake catalog and the live
      witness over an input table {stored generated column whose
      expression names one column; one naming two columns with a cast;
      a generated column beside an identity column on the same table;
      a generated column whose own name the declaration cannot carry
      (the existing Omitted rule wins and its line says so)}: the
      starter emits the DSL's generated-column builder with the
      catalog's expression text (`pg_get_expr`, the same reading the
      defaults use) and never a plain column; `hejbro check --url`
      against the imported database reports no differences for that
      column; the pulled contract's Insert and Update shapes omit the
      column (the ALWAYS family, as `contract/tables.ts` already does
      for identity). If the DSL cannot carry the expression the reading
      found, an Approximated line names the column and says what was
      dropped — never silence. Live: the review's `gen1` database
      (`/private/tmp/d106-cf/sql`) round-trips `total` and `label`
      through import → baseline → dump diff with `GENERATED ALWAYS AS
      … STORED` on both sides. Files: infer sources and tests,
      `from-catalog.ts` if needed, live witness.

- [x] 2.2 (~8m) Text that the review measured false or unstated. B2:
      the delta's scenario *A reference into a schema the run did not
      name is kept* and requirement 1's sentence say the reference is
      carried in the foreign-key metadata and `Relationships` and that
      no relation exists for it (a relation needs a `Tables` key for
      its target — schema-vendoring's own rule); the reviewer's
      `proj-gen1` and corpus contracts are the pins. N2: every loss
      line whose `Next:` says "then re-run `hejbro import`" says "re-run
      `hejbro import` into a fresh `--out` and merge the declarations,
      or declare it by hand" (import never overwrites). N5 (corrected
      after 2.2's own measurement, D106 R1 correction round): the
      requirement says the four outer bands keep the stated order, and
      the Approximated band's own inner order is a fixed sequence —
      UNIQUE, nextval, foreign-key-derived-name, primary-key-derived-
      name, then the blanket expressions line last. The code's own
      order (`approximationLines`, `infer/loss-report.ts`) was already
      this and did not change; the delta sentence was corrected to
      match. Within each band, its own lines still sort by code points.
      N8:
      (a) one "cannot be carried" clause per pull FK line, (b) pull's PK
      line speaks to the consumer (no `generate`/`check` promise), (c)
      one noun per constraint kind (a UNIQUE constraint is announced as
      a unique constraint whatever caused its omission). N11: pull's
      "pulled (…)" line and the lock list the schemas read, not the one
      the loss report omitted whole. Red: the loss-report and pull
      tests pin each sentence. Files: `loss-report.ts`, `pull.ts`,
      `import.ts`, their tests, the delta spec.

- [ ] 2.3 (~5m) Docs, changeset, ledger. The brownfield reference
      states: the grants the reading models are schema-usage and
      table-level (column- and sequence-level grants contribute no role
      name, N1); partitioning, inheritance, UNLOGGED, comments and RLS
      enablement are not read and are listed in the "Not inferred" band
      only when #1034 lands (N4 — until then the reference names
      them); a collision where neither name yields its key back is
      resolved by physical order (N6); `to current_user`/`session_user`
      policies report the resolved role (N9); not-inferred column lines
      say nothing about `check` (N10). `pnpm changeset` → `patch`; one
      ledger row per task; README badges. Files: the reference,
      `.changeset/*.md`, `task-times.csv`, `README.md`.
