# Tasks: harden-function-locals

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/core/src/plpgsql/reserved.ts`,
`packages/core/test/plpgsql/reserved*.test.ts`, `packages/pg/test/
integration.test.ts` or the core Docker witness that already sweeps
category T (1.1); `packages/core/src/plpgsql/body-context.ts`,
`packages/core/src/dsl/table.ts`, their tests (1.2); `packages/core/src/
dsl/define-function.ts`, `packages/core/src/plpgsql/body-context.ts`,
tests (1.3); `skills/hejbro/references/function-builder-pitfalls.md`,
one `.changeset/*.md` (1.4). If a task appears to need any other file,
that goes back to the planner, not into the diff.

**Ordering.** 1.1 first (its measured list is what 1.2's tests import);
1.2 then 1.3 (1.3's seeding relies on 1.2's name rule); 1.4 last.

## 1. Body locals

- [ ] 1.1 (~10m) **[design]** The reserved class is R, T and C. Settles
      the list and the requirement's class statement. Red: the reserved
      test file's category sweep gains an `it.each` over every category-C
      keyword (read from `pg_get_keywords()` on a live `postgres:17`, the
      way the T sweep was measured, and vendored as a literal table in
      the test): each is refused as an argument name, as a loop name and
      as a row-declared local with `reserved-local-name`; `exit` and
      `elsif` are accepted in all three positions. The Docker witness
      records, per C name, what the server does with the unrefused
      spelling (syntax error / mode reparse / declaration failure) so the
      scenario's claim is measured, not inferred. Files: `reserved.ts`,
      its tests, the witness.

- [ ] 1.2 (~10m) Loop, row and column names. Red (a): `packages/core/
      test/plpgsql/*.test.ts`, a table over loop and row names
      {`my-loop`, `Row`, `2nd`, `a b`, ``, `naïve`} → `invalid-sql-name`
      naming the function and the name; {`row_a` + `Row_a`} →
      `invalid-sql-name` on `Row_a`, never `duplicate-local-name`; {two
      loops `r`}, {loop `r` + row `r`} → `duplicate-local-name`. Green:
      `registerLocalName` runs `assertSqlName` first. Red (b):
      `packages/core/test/dsl/table*.test.ts`, `{userId, user_id}` both
      orders and `{aB, xY, x_y, a_b}` → `duplicate-column` naming the
      table, both keys and the shared name. Files: `body-context.ts`,
      `table.ts`, tests.

- [ ] 1.3 (~7m) The ledger is seeded with the argument names. Red: a
      table {`args: { x }` + loop `x`}, {`args: { x }` + row `x` with
      column `id` — accepted, derived local `x_id` is free}, {`args:
      { x_id }` + row `x` over column `id` → refused}, {`args: { x }` +
      loop `y` — accepted} → `duplicate-local-name` naming the argument
      where refused. Green: `defineFunction` hands the derived argument
      names to the recording state before the body runs. Files:
      `define-function.ts`, `body-context.ts`, tests.

- [ ] 1.4 (~6m) Docs and changeset. `function-builder-pitfalls.md`
      states the three checks a local name passes (SQL name, reserved
      including column-name keywords, duplicate including arguments);
      `pnpm changeset` → `patch`. Files: the reference, `.changeset/*.md`.
