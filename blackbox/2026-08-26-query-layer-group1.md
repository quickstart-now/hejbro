# 2026-08-26 — add-query-layer group 1: one vocabulary, D94 amended

Refs:
- packages/core/src/expr/ast.ts @ blob 4b863e498a024303465536c34057292401adc289
- packages/core/src/expr/codec.ts @ blob 57512a960239a093166dcada6034b7216d23f118
- packages/core/src/expr/render-sql.ts @ blob 17b4948922781e4e48d417ce637313cb616489b0
- packages/core/src/query/select.ts @ blob 4e4f69be8573e701dde5b36b5a98b3f7eda7f129
- packages/core/src/query/mutate.ts @ blob 11d682235f06468ab7f855829bf23d70292a4a3c
- packages/core/src/index.ts @ blob 4ba7af3a1667de60ddd52d03fad116ee59608c7e
- packages/query/package.json @ blob d543b98afffe31270e01c982b0a1574e413b08ed
- packages/query/vitest.config.ts @ blob 869d3b27c118804cb49cdc8e693b6d6df28031f4
- openspec/changes/add-query-layer/tasks.md @ blob 75e48cf01089d06b20ce6300f414c64cdf99ae12
- openspec/changes/add-query-layer/design.md @ blob bfb5ec7c859ad40f59ffd74367923fd7d7774f20
- openspec/changes/add-query-layer/proposal.md @ blob 470bd5b09893c88b91030f337acd0655c2d9ffb8
- docs/specs/2026-08-19-hejbro-design.md @ blob 2c6672457300b728893d0f6d928173192c4c2e86
- openspec/task-times.csv @ blob a5b6e4513db9f3ef71095fc91952d77147aacfdb

Session: Claude Code (Fable 5), 2026-08-26 — same session as the
proposal entry (PR #304). Owner inputs are English rewrites of Korean
originals.

---

## Input — merge and start implementing

> Merge it, and let's start implementing with /opsx:apply.

PR #304 was squash-merged by this instruction (dev `9496d49`, push CI
green: ci + release-version both success), and the apply workflow
started on change `add-query-layer`, group 1, in worktree branch
`phase10-query-ir`.

## Input — the discovery, and the owner's call

After task 1.1 (the `packages/query` scaffold), the implementation
inventory contradicted a premise of the plan: core already owns the
complete statement vocabulary — `QueryNode`
(select/insert/update/delete) in `expr/ast.ts` and the
`select`/`insert`/`update`/`deleteFrom` builders in `query/` — because
declarations contain queries (view bodies, function bodies, RLS
`exists()`). D91–D98's D94 said "the statement IR and its compiler live
in a new pure package", with "the statement IR inside core" listed as a
rejected alternative — wording written before this inventory existed.
Building the planned second IR would have produced two `select()`
surfaces and duplicated the exact vocabulary decision ④ exists to
unify.

Presented to the owner as one decision with the inventory as
background (deep-background-then-one-question cadence), two options:
(가) reuse core's vocabulary as the single statement vocabulary, close
the v1 gaps (left join, returning column selection) additively in core,
and amend D94's wording; (나) keep D94's letter and build the separate
IR. The owner chose:

> (가) — reuse the core vocabulary.

That answer is the owner approval for the D94 amendment (decision-log
changes are a hard gate); the amended row records both the original
decision and the amendment with its reason. proposal.md and design.md
were updated in the same commit to stay coherent; the six capability
delta specs needed no change (behavior contracts, not IR-location
statements).

## Input — AI-native performance badges (filed, separate change)

> Also: I think the root README should carry badges for values we can
> treat as metrics — average time per task, percentage-style figures.
> Since this project is being developed AI-natively, shouldn't we be
> recording what that performance actually looks like? (As I said
> before, time spent waiting on the user's decisions is excluded.)

Filed as #305 (Task, documentation, sub-issue of #282), modeled on the
CRAP badge precedent (#278/#280: README block + refresh script + CI
drift check), reading `openspec/task-times.csv`, whose separate
`waited_user_min` column is what makes the exclusion structural. Not
part of this PR; scheduled after the ledger has real rows.

## What was built (group 1)

- Task 1.1: `packages/query` scaffold (private until task 7.3 settles
  release mechanics; no build script until 7.1 defines the public
  surface). Red test = the #131 source-alias guard.
- Task 1.2: `joinKind: "left"` as an additive union variant
  (`joinKinds` as-const set), `leftJoin()` stage (shared `appendJoin`
  helper), kind-aware join rendering, codec acceptance — the codec's
  fail-open guard test, which had used `"left"` as its unknown-value
  example, now uses `"right"`.
- Task 1.3: `returning({ alias: expr })` object projections on
  insert/update/delete (shared `resolveReturning`; aliases
  snake_cased like the select projection; `empty-returning` fail-fast),
  no-arg behavior unchanged. `ReturningProjection`/`JoinKind` exported
  per the index convention.
- tasks.md group 1 reworked under the amended D94 (35 → 32 tasks; the
  original 1.2/1.4/1.5 [design] items are settled: call shapes = core's
  existing surface, join variant and returning selection by symmetry);
  group durations appended to `openspec/task-times.csv`; one `minor`
  changeset (fixed group — naming core moves all three).

## Internal processing

Strict TDD per task: scaffold red = vitest unrunnable without the
package; left-join red = `leftJoin is not a function` + codec
`unrecognized "left"`; returning red = three failures including the
runtime silently ignoring the extra argument. Gates after each green:
Biome 323 files clean, check-types 12/12 turbo tasks, full test suite
green (core 807 + query 1), CRAP 0/976. retarget/walk needed no changes
(kind-agnostic spreads, verified by grep before deciding). Estimates
vs actuals recorded per task; the IR-strategy owner wait (~1 min) is in
`waited_user_min`, not `actual_min`.
