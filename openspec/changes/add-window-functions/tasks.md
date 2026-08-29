# Tasks: add-window-functions

Groups are parallel-safe slices (no file overlap). Group 2 starts after
group 1 (it builds on the node group 1 defines); group 3 after 2; group 4
after 2; group 5 after 1–4. Estimates are pure work minutes (D88).

**Precondition for every group**: #444 (`fix-select-traversal`) is merged
to `dev` and this branch is rebased onto it. Child expressions inside a
window clause are traversed through the existing exhaustive registries and
#444's helper. Adding an arm *inside* one of those registries is the
point; what this change must not do is stand up **a new traversal
function or loop of its own outside them** (proposal, "Traversal
discipline").

## 1. The WindowNode and its compiler-forced propagation

- [x] 1.1 (~8m) [design] `WindowNode` variant on `ExprNode` + its
      renderer. Settled here: field names (`fn`/`partitionBy`/`orderBy`),
      the snapshot token (`window`), `fn` narrowed to `FunctionCallNode`
      rather than `ExprNode`, and the exact emitted text (`over (partition
      by … order by …)`, clause order, omission when empty). Red:
      `packages/core/test/expr/window-node.test.ts` — "renders a window
      function with partition by and order by". Files:
      `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [x] 1.2 (~6m) `collectColumnRefs` descends into `fn.args`,
      `partitionBy` and `orderBy`, so scope validation sees them. Red:
      same file — "over() partitionBy referencing an out-of-scope table
      throws foreign-column-ref". A projection-level reference does not
      exercise this and does not substitute for it. Files:
      `packages/core/src/expr/render-sql.ts`, that test.
- [x] 1.3 (~8m) Codec: `NODE_KIND_TO_SNAPSHOT` entry plus encode/decode
      handlers, round-tripping all three child positions. Leniency follows
      #444's R4: a missing field is tolerated only where an older version
      actually wrote it out, and `window` is new in this format — so a
      stored node missing `fn` is corruption and throws rather than
      decoding into something plausible. Red:
      `packages/core/test/expr/codec.test.ts` — "a window function
      survives encode/decode" and "a window node without its function
      call is rejected, not repaired". Files:
      `packages/core/src/expr/codec.ts`, that test.
- [x] 1.4 (~7m) `walk.ts`'s two handler maps — `SomeExprNodeHandlers`
      (shared by the shallow and deep walkers) and `ScopeViolationHandlers`
      — and `retarget.ts`'s arm,
      plus a `reachable-kinds` producer (a view whose body carries a
      window function) so D70 sees the new vocabulary. The two maps carry
      different meanings — decide each; the shallow/deep pair sharing one
      type does not mean they want the same answer. The producer lives
      in the `reachable-kinds`/`naming-conventions` in-memory fixture and
      **not** in `test/golden/cases/` — the goldens stay unchanged (see
      Verification). Red:
      `packages/core/test/naming-conventions.test.ts` completeness (red
      the moment the discriminator exists unproduced). Files:
      `packages/core/src/expr/{walk,retarget}.ts`,
      `packages/core/test/expr/reachable-kinds.ts`,
      `packages/core/test/naming-conventions.test.ts`.
- [x] 1.5 (~6m) Positive descent proof: `retarget.test.ts`'s
      hand-written descent list gains the window case. The registries force
      a handler to exist, not to descend — `window: (node) => node`
      compiles and passes the reference-identity loop. Red:
      `packages/core/test/expr/retarget.test.ts` — "a column referenced
      only inside over()'s partitionBy is rewritten by a rename". Files:
      that test only.
- [x] 1.6 (~8m) The two consumers outside `packages/core`: `params.ts`'s
      lift handler (literals inside the clause become `$n`) and the
      Supabase validator's `childrenOf` arm (an `auth.uid()` hidden in
      `partitionBy` is still reached). Red:
      `packages/query/test/compile/window.test.ts` — "literals inside
      over() are lifted in statement order"; and the validator's own test
      — "an uncached auth call inside over() is reported". Files:
      `packages/query/src/compile/params.ts`,
      `packages/supabase/src/validators/rls-uncached-auth-call.ts`, those
      tests.
- [x] 1.7 (~8m) Positive descent proof for the **two walk workers**, the
      same way 1.5 does it for `retarget`. 1.5 covered one registry;
      review found both `walk.ts` arms at zero coverage, and deleting them
      left the whole suite green — the exact trap this change documents,
      one registry over. Prove each through its real consumer: an
      `exists()` hidden in `over()`'s `partitionBy` inside a `check`
      constraint is still refused by the existing `check-subquery` guard
      (`someExprNode`), and a **cached** `auth.uid()` — `(select
      auth.uid())` — hidden inside a **column default** is still reported
      by `rls-cached-auth-outside-rls` (`someDeepExprNode`, a different
      validator from 1.6's). The column default is not a substitute site
      but the only reachable one: that validator scopes RLS
      `using`/`with check` out deliberately, and in a `check` or an index
      predicate core's own subquery guards hard-error before it runs.
      Red: those two guards' own test files; `window: () => false` in
      either arm must turn them red. Files: those tests, plus
      `walk.test.ts` — CRAP coverage is measured per package, so a core
      function whose only consumers live in another package needs a
      core-local test alongside the real-consumer one.
- [x] 1.8 (~6m) View-level round-trip: a view whose body carries a window
      function is serialized **and decoded back**, not just the node in
      isolation. 1.3 proves the mechanism; this proves the path the
      proposal names as the whole reason for D104 ("a view carrying a
      window function would round-trip into a different view"). Red:
      `packages/core/test/view-lifecycle` (or the view-kind test) — "a
      view with a window function round-trips through the snapshot".
      Files: that test only.

## 2. The vocabulary and the over() wrapper — after group 1

- [x] 2.1 (~10m) [design] The `WindowFunctionCall` brand and the eleven
      window-only constructors in a new `expr/window.ts`, including their
      argument shapes (`lag`/`lead` take an offset and an optional
      default, `nthValue` an index, `ntile` a bucket count). Settled here:
      that the brand deliberately lacks `exprNode` so a bare call is
      unusable — `Expr` requires both `family` and `exprNode`, so dropping
      one is enough, and `family` is kept because it is real runtime data
      the comparison operators read to lift the other operand — and how
      `family`/`ReadAs` ride along to survive `over()`. The five value functions take **one** signature each —
      supplying a default does not narrow the result (proposal, "The value
      functions take one signature, not two"). Red:
      `packages/core/test/query/window.test.ts` — "a bare rowNumber() is
      not accepted where an Expr is required" and "lag, lead and nthValue
      pass the operand's type through whatever their extra arguments".
      Files: `packages/core/src/expr/window.ts`, that test.
- [x] 2.2 (~8m) [design] `over(expr, spec)` — one generic taking either
      input (an aggregate `Expr` or a `WindowFunctionCall`; declared
      overloads were tried and rejected by `TS2394`, the `Omit`-based
      brand not being compatible with the implementation signature), what
      `spec` accepts,
      and the `invalid-over-target` error for a non-function-call operand.
      Red: same file — "over() wraps an aggregate and a window-only call
      into the same node". Files: `packages/core/src/expr/window.ts`,
      that test.
- [x] 2.3 (~6m) Public surface: `index.ts` exports and the `hejbro`
      re-export assertion. Red: `packages/cli/test/exports.test.ts` — the
      new names are missing from the asserted surface. Files:
      `packages/core/src/index.ts`, that test.

## 3. Placement rejection — after group 2

- [x] 3.0 (~7m) Retire the order-term duplication group 2 introduced.
      `expr/window.ts`'s `WindowOrderTerm`/`resolveWindowOrderTerm` are a
      byte-for-byte copy of `query/select.ts`'s
      `OrderTermInput`/`resolveOrderTerm` (identifiers aside). The
      dependency argument for copying is sound — `expr/` must not import
      from `query/` — but promotion is the third option it missed:
      `OrderByTerm` already lives in `expr/ast.ts`, so moving the input
      type and its resolver down into `expr/` and re-exporting from
      `query/select.ts` keeps the direction and removes the copy. Drift
      here is user-visible and silent: give `OrderTermInput` a `nulls`
      option later and window `orderBy` quietly lacks it with nothing
      turning red. Do this in the same pass as 3.1 — both touch
      `query/select.ts`. Red: existing order-by tests on both sides stay
      green through the move; add nothing. Files:
      `packages/core/src/expr/{window,ast}.ts`,
      `packages/core/src/query/select.ts`.
- [x] 3.1 (~8m) [design] `where()`/`groupBy()`/`having()` reject an
      argument containing a window function, via the existing
      `someExprNode` (the `exists` rejection is the precedent) — no new
      walker. Settled here: the shallow variant is correct (a window
      function inside an `exists` subquery's own select list is legal), the
      error code `window-function-not-allowed`, and the message naming the
      clause plus the remedy. `distinctOn` is **not** rejected — Postgres
      accepts it. Red: `packages/core/test/query/window-placement.test.ts`
      — "where, group by and having refuse a window function; distinct on
      accepts one". Files: `packages/core/src/query/select.ts`, that test.
- [x] 3.2 (~6m) [design] The reverse nesting: an aggregate whose argument
      contains a window function is refused. Settled here: its own error
      code (`windowed-aggregate-argument`) and message, kept separate from
      3.1's — Postgres refuses this with a different class than the
      placement rule (`42803`, `aggregate function calls cannot contain
      window function calls`, versus `42P20`), and collapsing the two
      would describe one rule where there are two. The forward nesting (a
      window inside a window) needs no message at all: `fn:
      FunctionCallNode` makes it unrepresentable. Red: same file — "an
      aggregate refuses a windowed argument". Files:
      `packages/core/src/expr/aggregate.ts`, that test.
- [x] 3.3 (~8m) [design] The three declaration sites that **already** have
      a subquery guard — `check` constraints (`dsl/table.ts:694`), index
      expressions (`:392`) and index predicates (`:756`) — refuse a window
      function too. Same shape as the precedent: `someExprNode` (the
      shallow one, matching 3.1 — a window inside an embedded query's own
      select list is legal) plus `throwHejbroError(code, "… Next: …")`.
      Settled here: the error codes, following the existing family's
      naming (`check-subquery` → `check-window-function` and siblings) and
      distinct from 3.1's and 3.2's, and whether the guard is shared or
      per-site. The precedent answers half of that already: the `exists`
      rejections share the *helper* but keep code and message *per site*,
      each naming its own site and remedy. A single generic message
      covering all six would not. Each site carries its own red test — "the same helper
      covers it" is what let `retargetTableRef`'s gap survive into #110.
      Red: `packages/core/test/dsl/window-declaration.test.ts` — "a check
      constraint, an index expression and an index predicate each refuse a
      window function, each naming its own site". Files:
      `packages/core/src/dsl/table.ts`, that test.
- [x] 3.4 (~8m) The three declaration sites with **no** precedent guard —
      column defaults, generated columns, and a policy's
      `using`/`with check`. These are new guard homes, not extra arms on
      an existing one, which is why they are split from 3.3. Same shape
      and error-code family as 3.3; one red test per site. Red: same file
      — "a column default, a generated column and a policy each refuse a
      window function". Files:
      `packages/core/src/dsl/{table,rls}.ts` (the sites' actual homes),
      that test.

## 4. Result typing and conversion — after group 2

- [x] 4.0 (~5m) Two cleanups review flagged. (a) `walk.ts`'s deep arm
      gains one line: the in-repo consumer path is closed by 3.3/3.4, and
      the arm exists for presets calling the **public**
      `someDeepExprNode` — a reader of `walk.ts` alone would otherwise
      assume an internal caller still reaches it. (b) `window.test.ts`'s
      bare `toThrow()` on the degenerate `sum(rowNumber())` call is
      narrowed or the runtime call dropped: the contract there is the
      `@ts-expect-error`, and an unqualified `toThrow()` stays green even
      if the guard breaks. Files: `packages/core/src/expr/walk.ts`,
      `packages/core/test/query/window.test.ts`.
- [x] 4.0b (~7m) Two refinements review produced after 4.0 landed.
      (a) The degenerate `sum(rowNumber())` keeps its `@ts-expect-error`
      but loses its **runtime call** — narrowing the throw is not enough.
      It passes today because the guard walks an `undefined` node into a
      `TypeError`; asserting that pins an accident as a contract. Follow
      `column-builder.test.ts:866`: keep the statement, drop the
      execution, let the directive be the assertion (`check-types`
      enforces it — group 2 proved so via `TS2578`). The real 3.2 contract
      is already held by `window-placement.test.ts:109/121`.
      (b) The 1.7 supabase test becomes **self-pinning**: beside the
      hand-assembled declaration, assert that `table()` *does* reject the
      same shape (`column-default-window-function`). That rejection is the
      reason the hand assembly exists; without it, a later relaxation of
      3.4 reopens the real path while the test quietly stays on the
      detour, and nothing anywhere connects the two. Prose alone is the
      form #87 already rejected for exactly this class of claim.
      Note for the record: `window` does **not** belong in
      `UNREACHABLE_NODE_KINDS`. That list is about node kinds being
      *produced* into a serialized declaration, and views still produce
      this one. What is unreachable is one handler arm's in-repo caller —
      a different axis, and one that list does not track.
      Files: `packages/core/test/query/window.test.ts`,
      the `rls-cached-auth-outside-rls` test.
- [x] 4.1 (~8m) [design] What each window function reads back as:
      `rowNumber`/`rank`/`denseRank` carry `ReadAs<bigint>`;
      `ntile`/`percentRank`/`cumeDist` need no brand (they arrive as JS
      numbers); the value functions pass their argument's type through.
      Settled here: whether the existing brand reaches through `over()`
      unchanged or needs threading. Group 2's surface makes the `family`
      side already work, but that is a different axis — pin
      `ReadAs<bigint>` **surviving `over()`** at the type level, since a
      regression in the union-parameter form would show up exactly there
      and nothing currently holds it. Red:
      `packages/query/test/types/window.test.ts` — "rowNumber reads as
      bigint; ntile reads as number; lag keeps its argument's type".
      Files: `packages/query/src/types/select-result.ts` (if threading is
      needed), that test.
- [x] 4.2 (~8m) `convert.ts`'s window arm delegating to `expr.fn`, so a
      windowed aggregate converts exactly as the aggregate does — **plus**
      recognising `row_number`/`rank`/`dense_rank` as `bigint` the way
      `count` already is **and the five value functions as passthroughs
      the way `min`/`max` already are**. The delegation alone is not
      enough: none of those eight names appears in `COUNT_STATE`'s branch
      or in `PASSTHROUGH_AGGREGATES`, so `over(rowNumber(), …)` would
      arrive as the string `"1"`, and `over(lag(col), …)` over a
      `bigint({mode:"number"})` column would arrive as text while 4.1's
      type says `number | null` — the same defect twice, and the second
      one is *unintentionally* missing where `sum`/`avg` are deliberately
      absent (Postgres promotes those; these return the argument's exact
      type, which is what makes `min`/`max` delegable in the first place).
      The bigint constant's name stops being true once three more
      functions share it — rename it rather than leave a comment that
      describes `count` only. Red:
      `packages/query/test/db/window.test.ts` — "a projected rowNumber
      arrives as a bigint, not a string" and "count() over (…) still
      converts like count()". **Every one of the eight names carries its
      own assertion**, plus one multi-argument form (`lag(operand, offset,
      default)` or `nthValue(operand, n)`): a name list is exactly the
      shape where a typo or an omission converts nothing and no test
      notices — deleting four of them from the list must turn this file
      red. `sum`/`avg` get a pinning assertion of the opposite kind: they
      stay unconverted through the delegation. Files: `packages/query/src/db/convert.ts`,
      that test.
- [x] 4.3 (~7m) The chain surface reaches the same node as the core
      builder, **and refuses what the core builder refuses**. The chain
      delegates its `where`/`groupBy`/`having` to core today, so 3.1's
      guards come along — but that is a fact about the current code, not a
      contract, and criterion 15 (ask the same question on the other path)
      applies: prove the rejection on the chain, not only on the builder.
      Red: same file — "a chain-built window projection compiles
      byte-identically to the core builder formulation" and "the chain's
      where/groupBy/having refuse a window function too". Files:
      `packages/query/src/db/chain.ts`, that test.

## 5. Live witness and the paperwork — after groups 1–4

- [x] 5.1 (~10m) Docker postgres:17: `row_number` restarting at 1 in each
      partition (assert the value sequence — a row count is unchanged even
      if the window degenerates to a constant, so it proves nothing), a
      windowed `sum` running total, and `lag` returning null at a
      partition edge. Also the arrivals the type table *claims need no
      conversion* — `ntile` as a number, `percentRank`/`cumeDist` as
      numbers, not the text a driver hands back for some types — and
      `count() over (…)` as a `bigint`, which is where the node shape's
      known regression would surface. And one behaviour the docs will
      assert: under the default frame `lastValue` returns the *current*
      row's value, not the partition's last — Postgres's own warning, and
      the reason `lastValue`/`nthValue` are of limited use until frames
      land. Writing that in the skill without a live check would be the
      same unbacked claim in prose form. A declared read type with nothing
      backing it is the defect this change's own spec names; the claim
      that *no* conversion is needed deserves the same live check as the
      claim that one is. Verify load-bearing by asserting `typeof` is
      `"string"` on the `bigint` arrival and watching it fail. Run with
      `pnpm --filter @hejbro/pg test:integration` — `pnpm test` excludes
      this file and would report green having run none of it. Files:
      `packages/pg/test/integration.test.ts`.
- [ ] 5.2 (~8m, docs) `skills/hejbro/references/query-layer.md`: a window
      functions section with the type table, and window removed from the
      "not supported" line — that line names CTEs too, and #417 keeps
      them. Changeset (D59, `minor`), `openspec/task-times.csv` rows,
      README task-time and CRAP badges. Beware: writing about
      `@ts-expect-error` in a comment makes TypeScript treat it as a real
      directive — the token has to be broken up, and backticks do not
      help.
- [ ] 5.3 (~6m) The D104 rows in `docs/specs/2026-08-19-hejbro-design.md`.
      The wording is **already approved** (lead, 2026-08-29) and sits in
      this change's `design.md` — transcribe it verbatim rather than
      re-deriving it; that file is owner-gated and the approved text is
      the record of the delegation being exercised. Summary-table row and
      decision-log row go in **one commit**, as D103 did.
- [ ] 5.4 (~10m) The `blackbox/` entry (D89) — this is an owner-driven
      change, so it carries one in the same PR: what was asked, what was
      built, why, and the internal processing, with per-file git blob SHA
      pins per `blackbox/README.md`. The owner-interaction context is
      quoted verbatim in Korean (the team did not hold it; the lead
      supplied it); the surrounding record is English. Include what this
      change got wrong on the way — a record that only lists what worked
      is not a flight recorder:
      the planner's two mis-instructions (the deep-walker proof routed
      through a validator that scopes policies out; stripping `family`
      from the brand when the operators read it at runtime); the
      field-vs-node cost claim that flattered its own conclusion and had
      to be re-measured after review caught it; the walk-arm coverage
      blocker — this change fell into the trap it exists to document,
      one registry over from where it was looking; the task wording that
      was narrower than the work three times; and the rebase false
      alarm — the planner read working-tree files mid-replay and called
      it data loss, when the branch ref already pointed at the replayed
      commits. That last one is worth keeping for its shape, not its
      outcome: the diagnosis was wrong and cost nothing, because the
      response was freeze-first and forbid destructive operations. The
      standing correction is to check the ref and the object store, not
      only the files.

## Verification

- **Everything `.github/workflows/ci.yml` runs**, read off that file at
  the commit under test — not a list kept here, and not the
  `package.json` scripts whose names happen to start with `check:`. The
  prefix is a naming habit, not the CI contract: `build`,
  `smoke:pack-install` and `changeset status` gate a PR without carrying
  it, and `check:pnpm-publish-tool` carries it without gating a PR (it
  runs only in `release-publish.yml`). A hand-kept gate list drifts the
  way a hand-kept traversal list does; a list whose *boundary* is a name
  prefix drifts the same way one level up.
- Three are load-bearing for this change specifically:
  `check:next-marker` (every user-facing `HejbroError` carries a `Next:`
  clause) and `check:diagnostic-xref` (a code quoted inside another
  diagnostic's message must be one this codebase can actually throw),
  because the change introduces several new error codes; and
  `smoke:pack-install`, because task 2.3 widens the published export
  surface.
- Run the gates with turbo's cache disabled (`TURBO_FORCE=1`). The cache
  is content-addressed and shared across worktrees: a detached review
  checkout replays the *implementer's* logs and reports green having run
  nothing. Same failure shape as the integration suite reporting green
  after running zero tests.
- `check:crap` and `check:tasktime` are **not** judged by exit code. Both
  rewrite `README.md`, and CI's verdict is `git diff --exit-code --
  README.md` after each, in that order. Running them inside a checkout
  modifies it — one more reason review runs in a detached worktree.
- `pnpm --filter @hejbro/pg test:integration` against a real postgres:17,
  with the executed test names listed and zero skipped.
- Goldens and example chains are expected to be **unchanged**: a new
  `ExprNode` variant leaves existing declarations' encoding
  byte-identical. A diff there means something else moved and is
  investigated, not regenerated.
