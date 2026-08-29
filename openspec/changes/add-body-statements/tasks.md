# Tasks: add-body-statements

Two groups. Group 1 is the body's statement surface — `ctx.execute`, the
unused-builder guard and the condition widening all edit
`plpgsql/body-context.ts`, so they are one slice and run in order, not a
parallel set. Group 2 is the declaration's `returns` surface and shares no
file with group 1. Estimates are pure work minutes (D88).

Tracking issues are the three this change closes, not new ones: group 1
is #426 and #423, group 2 is #433. The board-visibility the per-group
issue rule asks for is already there, and three issues for a two-group
change would be noise.

Two rules apply to every task here and are not repeated per line:

- A new diagnostic is raised through the `hejbroError`/`throwHejbroError`
  factory. `{ code, message }` literals and `new HejbroError(...)` are
  invisible to `check:next-marker`'s file selection (#461), so a diagnostic
  written that way passes the gate while breaking the contract the gate
  exists to enforce.
- A new diagnostic's message ends in a `Next:` clause and passes
  `declaredAt` as the factory's third argument, like every diagnostic in
  `plpgsql/body-context.ts` already does. `check:next-marker` exempts by
  *code*, and its six exemptions are all internal invariants a user
  cannot reach; adding a code there to get the gate green is not an
  option. `check:diagnostic-xref` is a narrower gate than it sounds — it
  only checks that a code *cited inside another diagnostic's message*
  exists, so it constrains cross-references, not registration.

## 1. The body's statement surface

- [x] 1.1 (~8m) [design] An `execute` body statement: `ctx.execute(...)`
      records a select, insert, update or delete in body order; the
      renderer emits `perform <sql>;` for a select and `<sql>;` for a
      mutation. [design] settles the member name, the admissible builder
      set, and that the new handler normalizes column order through
      `applyColumnOrderToQuery` like the handlers beside it — an executed
      statement that renders in physical column order would be
      non-deterministic in exactly the way `render-body.ts:125` already
      guards against. Also settles whether the new vocabulary makes
      `empty-if-statement`'s "user cannot reach this" exemption false; if
      it does, the exemption is dropped and that diagnostic gains a
      `Next:` clause here rather than in review.
      Red: `packages/core/test/plpgsql/render-body.test.ts` — "a select
      executed for effect becomes perform".
      Files: `packages/core/src/plpgsql/body-ast.ts`,
      `plpgsql/body-context.ts`, `plpgsql/render-body.ts`, that test.
- [x] 1.2 (~7m) [design] `ctx.execute` refuses a mutation carrying
      `.returning()`, at runtime (`returning !== null`) because the
      returning stage's type is a subtype of the stage before it. [design]
      settles the code name — `execute-expects-no-returning` unless a
      better fit is found in the `scalar-return-*` family — and the
      `Next:` clause, which names both working forms (drop the
      `.returning()`, or return the query when its rows are the result).
      Red: `packages/core/test/plpgsql/body-context.test.ts` — "an
      executed insert with returning is refused".
      Files: `plpgsql/body-context.ts`, that test, the xref reference.
- [x] 1.3 (~9m) [design] `plpgsql/recording-session.ts`: a session opened
      by `createRecordingContext` and closed by `finish()`, holding the
      whole mechanism — the sites in `query/*` only call into it. One
      call shape covers creation and supersession together
      (`noteBuilder(produced, supersedes)`), because every stage in a
      chain is both: `.returning()` produces a node and kills the node it
      spread from, and a set-op combinator does the same to its receiver
      while consuming its argument. [design] settles that call shape and
      whether consumption can instead be inferred by walking the recorded
      tree at `finish()`: reachability alone would need no instrumented
      consumers, but a chain's stages are spread copies (a parent node is
      never the node in the tree) and `buildExists` rewrites its
      subquery's projection, so measure both before choosing.
      **Settled by measurement: explicit registration, for creation and
      consumption both.** Reachability yields false positives — the kind
      that break working declarations — in every case but one: 19
      spread-copy sites across the two files with no
      return-the-same-reference shortcut anywhere, so no chain stage is
      ever the node in the tree; `buildExists` copies; `defineView` never
      enters the body's tree at all; and the json aggregates keep the
      reference or copy it *depending on the selected column's type*, so
      the same body would pass or fail by what it selects. A hybrid does
      not rescue it, since all of those are consumption.
      The session must be inert when none is open, must close even when the body
      callback throws (a session left open makes the *next* declaration
      inherit the previous one's builders and fail in an unrelated file),
      and must be a stack rather than a slot — a body can declare a view,
      and the determinism guard runs every body twice. The holder itself
      is module-scope of necessity: the `query/*` factories are free
      functions that can reach no `RecordingState`. What must stay single
      is the *lifetime* — opened and closed by `createRecordingContext`
      and `finish()` alone, never a second state that can drift from the
      recording it belongs to.
      Red: `packages/core/test/plpgsql/unused-builder.test.ts` (new) — "a
      chain's intermediate stages are not reported".
      Files: `packages/core/src/plpgsql/recording-session.ts` (new),
      `plpgsql/body-context.ts`, that test.
- [x] 1.4 (~8m) The `query/*` call sites, gated on an open session so
      `@hejbro/query`'s runtime chain
      (`packages/query/src/db/chain.ts:712,723,733,737` calls these on
      every query) tracks nothing and pays nothing.

      The boundary exception on these two files is **`recording-session.ts`
      calls and nothing else** — no refactor, no cleanup, no type or
      comment edits alongside. The list below is the exception's own
      scope, and a diff of these two files is checked against it.
      Function names are the contract; the line numbers point at
      `34be0bd` and are a convenience — if one does not match, correct
      the list here before touching the file, do not touch the file to
      match the list.

      **Entry and consumption sites — one line each.**

      | File | Site | ~line | Why |
      |------|------|-------|-----|
      | `select.ts` | `select` | 402 | produces the entry builder |
      | `select.ts` | `combineSetOp` | 150 | consumes the argument, supersedes the receiver |
      | `select.ts` | `buildExists` | 691 | consumes a select as an expression |
      | `select.ts` | `buildSelectExpr` | 672 | same, for the json aggregates |
      | `mutate.ts` | `insert` (its `values`) | 459 | produces the entry builder |
      | `mutate.ts` | `update` | 526 | produces the entry builder |
      | `mutate.ts` | `deleteFrom` | 583 | produces the entry builder |

      **Stage makers — a local helper, then every transition through it.**
      A stage maker is any function whose methods spread a new node —
      **the test is the transitions, never the name**: in `select.ts`,
      `makeStages` (240), `makeDistinctableStages` (320) and
      `makeSetOpStage` (190), whose own `orderBy`/`limit` make it one of
      these and not an entry site;
      in `mutate.ts`, `makeInsertConflictable` (413),
      `makeInsertReturnable` (398), `makeUpdateFilterable` (508),
      `makeUpdateReturnable` (493), `makeDeleteFilterable` (565) and
      `makeDeleteReturnable` (550). `makeInsertFinal` (390),
      `makeUpdateFinal` (485) and `makeDeleteFinal` (542) are **not** on
      this list and take no edit at all: they are leaves that wrap a node
      their caller already spread and registered, with no methods of
      their own.

      None of these knows its parent at its own top: each transition
      (`where`, `orderBy`, `returning`, `onConflict…`, …) spreads a new
      node *inside its own closure* and hands it straight to the next
      maker, so the parent only exists there. One line per transition would mean hoisting each
      inline spread to a `const` first — two edits where the transition
      needs none. Instead each stage maker gets **one local helper**
      closing over its own `query`:

      ```ts
      const derive = (next: SelectNode) => {
        noteBuilder(next, query);
        return makeStages(next, fromTable, projectionInput);
      };
      ```

      and every transition's `makeStages({ ...query, … })` becomes
      `derive({ ...query, … })`. The delegation inside the helper is
      whatever call that maker already made — the next maker in the
      chain, not necessarily itself (`makeUpdateFilterable` hands off to
      `makeUpdateReturnable`, which hands off to `makeUpdateFinal`). The
      supersession is then stated once per stage maker instead of once
      per transition, and a transition added later inherits it — the failure mode this guards against (a new
      transition whose parent is never superseded, turning working chains
      into errors) cannot be introduced by forgetting a line.

      The helper is the only new function the exception admits, so its
      body carries **the `noteBuilder` call and the recursive delegation,
      nothing else** — no branching, no normalization, no convenience.
      An empty helper is what keeps the exception an exception.

      Review criterion, mechanical: **every `{ ...query, … }` /
      `{ ...node, … }` spread in these two files reaches the session
      through a helper of that shape**, and no line changes for any other
      reason. The count is ~19 transitions (measured in 1.3) routed
      through 6 helpers, plus the 8 sites in the table above.

      **Signal the planner before starting** — the lead orders these two
      files against the team that owns them.
      Red: `packages/core/test/plpgsql/unused-builder.test.ts` — "the
      runtime query chain is unaffected".
      Files: `packages/core/src/query/mutate.ts`,
      `packages/core/src/query/select.ts`, that test.
- [x] 1.5 (~8m) The failure itself: a builder left unconsumed when
      `finish()` runs fails the declaration with
      `statement-builder-unused`, naming the statement kind and the body,
      with a `Next:` clause pointing at the form that fits what was
      dropped: `ctx.execute` for a statement built for its effect, and
      building inside the chosen branch for a builder that was made ahead
      of a choice (`ctx.return(flag ? update(…) : deleteFrom(…))` keeps
      the expression and loses nothing). Raised from the same place
      `scalar-return-missing` is raised.
      Red: `packages/core/test/plpgsql/unused-builder.test.ts` — "a
      statement built and dropped fails the declaration".
      Files: `plpgsql/body-context.ts`, `plpgsql/recording-session.ts`,
      that test, the xref reference.
- [x] 1.6 (~8m) The consumers that are not `ctx.return` all leave a
      declaration passing. Each is a case, because each is a way this
      guard can turn working code into an error: `ctx.row`,
      `ctx.rowOrNull`, `ctx.forEach`, `ctx.execute`; the expression
      consumers `exists`, `notExists`, `jsonArrayFrom`, `jsonObjectFrom`;
      the set-operation combinators, which consume an argument *and*
      supersede their receiver, and exist as six names on every select
      stage and six more on `SetOpStage` itself; and `defineView`, which
      takes a query and is legal to call from inside a body.
      Red: `packages/core/test/plpgsql/unused-builder.test.ts` — "a
      select consumed as an expression is not reported".
      Files: `plpgsql/recording-session.ts`, `plpgsql/body-context.ts`,
      `packages/core/src/dsl/define-view.ts`, that test.
- [x] 1.7 (~6m) `ctx.if` and `elseIf` take `Condition` instead of
      `Expr<"boolean">`, the widening #386 left for whichever change
      reached the body first.
      Red: `packages/core/test/plpgsql/body-context.test.ts` — "a sql
      fragment is a body condition".
      Files: `plpgsql/body-context.ts`, that test.
- [ ] 1.8 (~10m) The audit trigger from #426 as a real declaration in
      `examples/postgres`, with its migration and golden — the round-trip
      witness the issue asks for, and the first body in the repository
      that executes a statement.
      Red: `packages/core/test/golden/golden.test.ts` — the new case's
      generated SQL.
      Files: `examples/postgres/src/app.schema.ts`,
      `examples/postgres/migrations/*`, `packages/core/test/golden/cases/*`.
- [ ] 1.9 (~6m) `function-builder-pitfalls.md`: the `ctx` surface table
      gains `execute`, and the "a builder you build is a builder you use"
      rule replaces the silence the file currently documents around
      unreturned builders.
      Red: `packages/skills/test/snippet-compile.test.ts` — the reference's
      snippets compile.
      Files: `skills/hejbro/references/function-builder-pitfalls.md`.
- [ ] 1.10 (~6m) A trigger body that returns a *query* is refused. Today
      the shape check only fires when the declaration returns a scalar,
      so a trigger body's query passes and renders `return query …`
      inside a `returns trigger` function — SQL Postgres rejects at
      CREATE. The gap is the one the existing spec left: it names the
      expression case for triggers and not the query case. Runnable any
      time after 1.1, whose `ctx.execute` is what the `Next:` clause
      points at ("execute the statement, then return the trigger row").
      Red: `packages/core/test/plpgsql/body-context.test.ts` — "a query
      returned from a trigger body is refused".
      Files: `plpgsql/body-context.ts`, that test.

## 2. The declaration's return surface

- [ ] 2.1 (~7m) [design] `returns` accepts a column builder:
      `resolveFunctionReturns` branches on a runtime discriminator
      (`"columnState" in value` — no `isColumnBuilder` exists in the
      codebase today) and stores `columnState.typeNode`, while `TReturns`
      keeps the builder's own type rather than a node reconstructed from
      `TMeta`. [design] settles the discriminator's home and name.
      Red: `packages/core/test/define-function.test.ts` — "a
      parameterized type declared as a builder keeps its detail".
      Files: `packages/core/src/dsl/define-function.ts`, that test.
- [ ] 2.2 (~8m) [design] `FnResult` resolves a builder-declared return
      through `ColumnReadType<TReturns>` — the same type `args` already
      resolves through, so the two positions agree by construction.
      Not `ScalarReturnTsType`/`TypeNodeMeta`: those take a `TypeNode`,
      which structurally cannot carry `jsonType` or `enumValues`, so a
      `jsonb().$type<Payload>()` return would be `Payload` as an argument
      and `unknown` as a return — the asymmetry this change exists to
      remove, reappearing one level down. `ColumnReadType` is a strict
      superset of `BaseTsType` (it adds exactly `jsonType`), so nothing
      the type-node path resolves today gets worse; an enum return
      additionally sharpens from `string` to its literal union, which the
      runtime already satisfies.
      The conditional's absence fails *silently*: with `TReturns` widened
      to accept a builder and no branch added, `FnResult` matches neither
      the table nor the type-node arm and resolves to `never` — assignable
      to everything, so every misuse type-checks. A "not `never`"
      assertion is too weak to pin that; the cases assert *equality*
      (`toEqualTypeOf`), which `never` fails in the second direction.
      Numeric `mode` is deliberately not among this task's cases — until
      2.3 lands, a mode-carrying return is where type and runtime still
      disagree.
      One case is the claim itself, and it has to be a **scalar** enum
      return: the same enum column read through `select` and returned
      through a `returns`-an-enum function resolve to the same type. The
      table-returning path already routes through `SelectResult`, so a
      case built on it would re-assert something already true and catch
      nothing; the scalar path is the one that was split. An agreement no
      test states is one the next change splits without noticing.
      Red: `packages/query/test/db/fn-types.test.ts` — a builder-declared
      `varchar({ length })`, an enum, and a `$type`-branded `jsonb`
      return infer their exact types.
      Files: `packages/query/src/db/fn-types.ts`, that test.
- [ ] 2.3 (~8m) The declared numeric mode reaches the call: the scalar
      return carries `mode` (and `jsonType`), and `db.fn`'s conversion
      reads it instead of re-deriving `defaultNumericMode` from the type
      node. This is a real defect the builder form exposes, not a detail
      of it — today a declared mode has nowhere to live, so nothing
      disagrees yet.
      Red: `packages/query/test/db/fn.test.ts` — "a bigint return declared
      as number arrives as number".
      Files: `packages/core/src/dsl/define-function.ts`,
      `packages/query/src/db/fn.ts`, that test.
- [ ] 2.4 (~7m) `SKILL.md` and `dsl-cheatsheet.md`'s `defineFunction`
      surface show the builder form; the changeset (D59, `minor` — the
      five published packages move together); task-time rows for both
      groups and the README badges they feed.
      Red: `packages/skills/test/snippet-compile.test.ts` — the updated
      cheatsheet snippets compile.
      Files: `skills/hejbro/SKILL.md`,
      `skills/hejbro/references/dsl-cheatsheet.md`, `.changeset/*.md`,
      `openspec/task-times.csv`, `README.md`.
- [ ] 2.5 (~6m) The `blackbox/` entry: the owner-delegated decisions this
      change ran on — the boundary exception and why the alternatives to
      it fail, the four settled design questions, and the pre-hypothesis
      that "a builder not returned is an error", which measurement cut
      down to "a builder not *reachable* is an error". Written by the
      planner; this task is pinning it — `git hash-object` for every file
      the entry names, at final state, since the pin records the recorded
      state and not an earlier draft.
      Files: `blackbox/2026-08-29-add-body-statements.md`.
- [ ] 2.6 (~6m) A `returns` builder carrying `notNullElements()` is
      refused. That flag narrows an array's element type to exclude
      `null`, and on a column it is backed by the CHECK `table()` derives
      — a function's `returns` derives no such check, so honoring it in
      the type would promise something nothing enforces and the database
      is free to break. Refusing is the same call this project makes
      elsewhere for narrowing with nothing behind it, and it costs
      nothing a user cannot express another way. Two things the task has
      to get right: the refusal fires at a `returns` position only — the
      same builder is legitimate as an argument and on a column, and a
      check that leaks there breaks working declarations — and the
      `Next:` clause says *why* dropping the flag loses nothing (the
      returns clause derives no constraint, so the flag was never going
      to be enforced), because "not supported" alone leaves the user
      guessing what they got wrong. Runnable any time after 2.1.
      Red: `packages/core/test/define-function.test.ts` — "a returns
      builder with notNullElements is refused".
      Files: `packages/core/src/dsl/define-function.ts`, that test.

## Verification

Filled in when the groups land: the CI gate set of the day
(`.github/workflows/ci.yml`), plus `pnpm --filter @hejbro/pg
test:integration` locally. Baseline for comparison: every gate green at
`34be0bd` with no README diff, measured before any of this started.
