# Tasks: harden-function-locals

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `openspec/changes/harden-function-locals/design.md`
(1.1 — the measured table, recorded the way the category-T sweep of
`harden-core-derivations` was: measured on a live server, vendored into
the tests as a literal, never added as a Docker-gated suite of its own;
core's tests stay pure); `packages/core/src/plpgsql/reserved.ts`,
`packages/core/test/define-function.test.ts`,
`packages/core/test/plpgsql/body-context.test.ts` (1.2);
`packages/core/src/plpgsql/body-context.ts`, `packages/core/src/dsl/
table.ts`, their tests (1.3); `packages/core/src/dsl/define-function.ts`,
`packages/core/src/plpgsql/body-context.ts`, tests (1.4);
`skills/hejbro/references/function-builder-pitfalls.md`, one
`.changeset/*.md` (1.5); `packages/core/src/plpgsql/reserved.ts` and the
same two core test files (1.6 — review-born; its delta sentences are
already written, so `openspec/` is not edited by that task). If a task
appears to need any other file, that goes back to the planner, not into
the diff.

**Ordering.** 1.1 first (its measured table is what 1.2 imports); 1.2
before 1.3 (the reserved check runs inside the name rule); 1.3 then 1.4
(1.4's seeding relies on 1.3's two name spaces); 1.5 last.

## 1. Body locals

- [x] 1.1 (~10m) **[design]** The measurement the class rests on. The
      sweep runs on a live `postgres:17` and sweeps three name sets in the
      three positions a body renders a name — as an argument, as a loop
      record, as a row-declared local: (a) all 63 category-C keywords
      read from `pg_get_keywords()`, (b) the 16 names the shipped set
      holds that are neither R/T/C nor a plpgsql-declared variable
      (`exception foreach get loop perform raise while` + the `U`-listed
      `begin by declare execute if new old return strict`), (c) the
      counter-example pair `exit`/`elsif`. Each result is classified
      `syntax-error` / `mode-reparse` (created, but the signature
      changed — `pg_get_function_arguments` confirms) /
      `declaration-failure` / `harmless` (created **and** the name still
      means what it was given — verified by calling the function, which
      is what catches a silent substitution like `current_schema`). The
      table lands in `design.md` with the server version and the SQL that
      produced it, so 1.2's literal can be re-measured; `harmless` names
      are reported to the planner, never removed from the set. Files:
      `design.md`.

- [x] 1.2 (~9m) The reserved set and the class statement. Red:
      `define-function.test.ts` (argument position) and
      `plpgsql/body-context.test.ts` (loop name, row-declared local) gain
      an `it.each` over the whole category-C table vendored as a literal
      from 1.1's measurement — each name refused as an argument name, as
      a loop name and as a row-declared local (`json_array` and its ten
      underscore-bearing siblings are the ones a row read can actually
      derive; the rest are covered in the argument and loop positions
      and the table says so) with `reserved-local-name`; `exit` and
      `elsif` accepted in all three positions. Green: `reserved.ts` gains
      the 61 missing C names, and its doc comment states the class by its
      three sources (keyword categories R/T/C; the variables plpgsql
      declares itself, `new`/`old` among them; the statement words
      measurement shows failing), not by "plpgsql reserves for its own
      statements". Files: `reserved.ts`, its tests.

- [x] 1.3 (~10m) Loop, row and column names. Red (a):
      `packages/core/test/plpgsql/body-context.test.ts`, a table over
      loop and row names
      {`my-loop`, `Item`, `2nd`, `a b`, ``, `naïve`} → `invalid-sql-name`
      naming the function and the name; {loop `Row`} →
      `reserved-local-name` (the reserved check folds case and runs
      first, so the two rules never claim one name); {`row_a` + `Row_a`} →
      `invalid-sql-name` on `Row_a`, never `duplicate-local-name`; {two
      loops `r`}, {loop `r` + row `r`}, {two rows `r`} →
      `duplicate-local-name` naming both constructs; {row `found`} →
      accepted (a row name takes no reserved check). Green: a rendered
      name takes reserved (case-folded) → SQL name → duplicate, a row
      name takes SQL name → duplicate, and the two spaces are recorded
      separately — rendered (loop record, row-derived scalars) and
      construct (loop name, row name). Red (b):
      `packages/core/test/table-surface.test.ts`, `{userId, user_id}`
      both orders and `{aB, xY, x_y, a_b}` → `duplicate-column` naming
      the table, both keys and the shared name, in the order
      `duplicate-argument` uses (the reported pair is the first key whose
      derived name repeats an earlier key's, with that earlier key).
      Files: `body-context.ts`, `table.ts`, those two test files.

- [x] 1.4 (~8m) The rendered space is seeded with the argument names.
      Red: a table {`args: { x }` + loop `x` → refused, naming the
      argument}, {`args: { x }` + row `x` over column `id` → accepted,
      the derived local `x_id` is free}, {`args: { x_id }` + row `x`
      over column `id` → refused, naming the argument}, {`args: { x }` +
      loop `x` and separately row `x` in one body → refused},
      {`args: { x }` + loop `y` → accepted}. Green: `defineFunction`
      hands the derived argument names to the recording state before the
      body runs; they seed the rendered space only. Files:
      `define-function.ts`, `body-context.ts`,
      `packages/core/test/define-function.test.ts`,
      `packages/core/test/plpgsql/body-context.test.ts`.

- [x] 1.5 (~6m) Docs and changeset. `function-builder-pitfalls.md`
      states the checks a local name passes (SQL name, reserved
      including column-name keywords, duplicate across the two spaces
      including arguments) and that a row name is judged by the locals
      it declares; `pnpm changeset` → `patch`. Files: the reference,
      `.changeset/*.md`.

- [x] 1.6 (~8m) **[review-born]** `next` and `query`. The piece review
      found the one rendering hejbro accepts that the server refuses: an
      argument named `next` or `query` renders `return next;`, plpgsql
      reads its own `RETURN NEXT`, and a non-SETOF function fails at
      creation (42804) — `hejbro generate` writes a migration that cannot
      be applied. Red: `define-function.test.ts` and
      `plpgsql/body-context.test.ts` — `next` and `query` refused with
      `reserved-local-name` as an argument and as a loop name (neither
      name carries an underscore, so neither can be a `<row>_<col>`
      derived local — the table says so, as it does for the 52
      category-C names in the same position); and a row read *named*
      `next` accepted, since a row name is not reserved-checked. Add the
      shape the review reproduced as its own row: `args: { next }` with
      `ctx.return(a.next)` refused at declaration, so no migration is
      written. And a control table over the nineteen measured-harmless
      siblings (`exit`, `elsif`, `elseif`, `continue`, `assert`, `open`,
      `move`, `close`, `call`, `set`, `reset`, `commit`, `rollback`,
      `alias`, `constant`, `reverse`, `slice`, `diagnostics`, `stacked`)
      **accepted** in all three positions — that table is the guard
      against the refusal widening past the two names. Green: two entries
      in `reserved.ts`, alphabetically, and its doc comment's third
      source restated as a list of sixteen with the harmless siblings
      named. Files: `reserved.ts`, those two test files. The delta
      sentences are already written; do not edit `openspec/`.
