# Tasks: refactor-traversal-debt

Closes #472, #473, #474 — the three structural-debt findings of the
2026-08-29 UX/DX audit. **Plain cycle by design**: all three are internal
refactors, so there is no `proposal.md` here and there is no spec delta.
That absence is the plan, not an omission.

**A spec delta is a stop signal.** If any task turns out to need a change
to `openspec/specs/`, the public API surface, generated SQL, a file or
wire format, or CLI/error text, then that task is not a refactor. Stop
and report to the planner rather than widening the diff. Two such traps
were already found and defused before code (see *Contract traps*).

## The proof obligation

For an internal refactor, "the tests pass" is weak evidence: the tests
were written against the same code being rewritten. What makes this
change provable is **byte-level output identity plus a before/after
structural measurement**, both taken against a frozen base.

- **Base for every output comparison is `e95a268`** — for all groups, not
  each group's predecessor. Comparing against the previous tag would open
  a window where group N silently carries group N−1's drift. Code review
  (what changed and why) reads against the previous tag; the output
  comparison always reads against `e95a268`.
- **The bar differs by group, because #474 is not a refactor.** Groups 1
  and 2 rewrite how existing behavior is expressed, so their bar is
  absolute: **not one byte** of any golden, snapshot, migration, or
  rendered SQL may move. Group 3 *adds a declaration that did not exist*,
  and new output is its normal product, not a defect. Its bar is
  therefore **attribution, not absence**: read
  `git diff e95a268 -- examples/postgres` and account for every delta as
  the product of a new declaration; **any change to an artifact derived
  from a pre-existing declaration fails the group.** This is not the
  looser rule — "zero bytes" is replaced by "zero unexplained bytes",
  which is checkable line by line.
- **"No diff" counts only after a positive control** — and the control
  has **two** steps, not one. Deliberately alter one byte; **first
  confirm the alteration actually landed (`cmp`, or diff against the
  original), and abort if it did not**; only then check that the
  comparison catches it; then restore and report the empty result. The
  missing first step is not hypothetical: a substitution that matches
  nothing produces exactly the same empty diff as a clean tree, so a
  control built on `sed 's/x/y/'` where no `x` exists "passes" while
  testing nothing. An empty diff from a command that cannot fail is not
  evidence — including when the command is the control itself.
  And a landed edit is still not enough on its own: confirm the
  **property under test actually went away**, not merely that bytes
  moved. Measured instance — a control that rewrote
  `"invalid-kind-change"` to `"XXinvalid-kind-changeXX"` changed the file
  (so `cmp` passed) yet left a `toContain("invalid-kind-change")`
  assertion green, because the wrapped string still contains the
  original. Count remaining occurrences to zero, or assert on the exact
  property the test asserts on.

## Contract traps (found before code — do not rediscover these the hard way)

1. **#472's "29" is not a typo — it is `31 − 2`.** There are 31
   `invalid-kind-change` guards, measured independently by two people
   with different commands, converging on 31
   (`rg -c "invalid-kind-change" packages/core/src/kinds/*.ts`). The
   issue counted only what two helpers absorb: 11 `next` + 18
   `previous`. The remaining **2 are combined-message guards** —
   `kinds/enum-kind.ts:79` and `kinds/table-kind-emit.ts:823`, both
   `alter`, both reading `"… is missing its previous or next snapshot."`
   Splitting those into two helper calls **changes user-visible error
   text**, which AGENTS.md names as a contract. Both sites were read:
   their predicates are the same shape
   (`change.previous === null || change.next === null`), so a third
   helper `requireBoth` extracts them with the combined wording
   preserved byte-for-byte. That is the approved route.
2. **#472's guard *style* is load-bearing, and two styles already
   coexist.** The combined form above is one; the other is sequential —
   `grant-kind.ts:186`/`:203` and `view-kind.ts:266`/`:272` each use two
   separate guards, **in opposite orders**. So for an input where
   **both** snapshots are null, the message that actually gets thrown
   differs by site: `grant` throws `"grant alter change is missing its
   previous snapshot."`, `view` throws `"view alter change is missing
   its next snapshot."`, and `enum` throws `"enum alter change is
   missing its previous or next snapshot."` Three consequences, all
   mandatory:
   - **Preserve each site's existing style.** Combined sites take
     `requireBoth`; sequential sites take the two helpers **in their
     existing order**. Harmonizing the two styles — in *either*
     direction — changes observable error text. Consistency is not this
     issue's scope.
   - **In sequential sites, preserve each site's existing guard order —
     there is no common order to standardize on.** Measured by execution,
     not by reading: `grant`'s `alter` checks `previous` first
     (`grant-kind.ts:186`), `view`'s `alter` checks `next` first
     (`view-kind.ts:266`). They are opposites. Imposing either order on
     the other changes that site's both-null message, which is the very
     contract break this group exists to avoid.
   - **Never add a guard that does not exist today.** The `alter` guards
     are asymmetric on purpose-or-accident, and either way it is not this
     change's business: `sequence`, `function`, `trigger`, `rls`, and
     `policy` check **only `next`**, so a previous-null input currently
     falls through and dies later as a `TypeError`. Adding
     `requirePrevious` "for symmetry" converts that `TypeError` into an
     `invalid-kind-change` — a behavior change. (`schema` has no `alter`
     guard at all; it throws `unsupported-operation`, which is outside
     #472.)
   Source strings matching before and after is therefore *not* enough
   evidence: which guard fires first, and whether one fires at all, is
   part of the output.
3. **#473's traversal tables are 7, not 6, and they span three
   packages.** The seventh is `packages/supabase/src/validators/
   rls-uncached-auth-call.ts:73` (`ChildrenOfHandlers`), absent from the
   issue. Folding either the supabase table or `@hejbro/query`'s
   params-lift would require `@hejbro/core` to **export** the child
   registry — a public API addition, therefore an OpenSpec change and
   not this one. Both stay untouched here (see *Out of scope*).

## Out of scope, deliberately

- `packages/core/src/expr/walk.ts:277` (`ScopeViolationHandlers`) —
  carries per-kind scope extension, not pure structure. The issue
  excludes it.
- `packages/query/src/compile/params.ts:340` and
  `packages/supabase/src/validators/rls-uncached-auth-call.ts:73` — both
  need a public export to fold. One follow-up issue covers both (same
  mechanism, so splitting them would be over-filing), filed under #412
  and cited in #473's close comment.
- `packages/core/src/expr/codec.ts`'s `NODE_KIND_TO_SNAPSHOT` and
  `packages/core/test/expr/reachable-kinds.ts` — these **look** like
  duplication and are not. `.claude/rules/naming.md` records why they are
  separate deliberate ledgers: in #110 a `rawSql` spelling error
  round-tripped silently precisely because encode and decode shared one
  map. Folding them re-opens that failure. A proposal to "deduplicate"
  them is rejected on this ground.

## File ownership

No two groups share a file. Group 1 owns
`packages/core/src/kind/emit-helpers.ts`, the ten
`packages/core/src/kinds/*.ts` files that hold guards (`enum`,
`function`, `grant`, `policy`, `rls`, `schema`, `sequence`, `trigger`,
`view`, `table-kind-emit`), and its own new test. Group 2 owns
`packages/core/src/expr/{walk,render-sql,retarget}.ts`, the new registry
module, and its own new test. Group 3 owns `examples/postgres/**` and
`skills/hejbro/references/dsl-cheatsheet.md`.
Group 4 owns `.changeset/`, `README.md`, and
`openspec/task-times.csv`. A task that appears to need another group's
file goes back to the planner instead of into the diff.

**`tasks.md` itself is the planner's file and no group owns it.** The
planner edits it, the implementer never does, and ticks are applied only
after a group's verdict passes — riding along in the implementer's next
commit. So this file appearing in *any* handoff tag is expected and is
never an ownership violation; it is the one path by which a planner edit
reaches the branch.

Groups 1–3 are parallel-safe, but one implementer works them serially in
this order: **3.1 first**, then group 1, group 2, the rest of group 3,
group 4. Task 3.1 leads because its result can delete later work, and an
answer that arrives late is the expensive kind.

Tracking issues are #472 (group 1), #473 (group 2), #474 (group 3) — the
findings are themselves the board-visible layer, so no new tracking
issues are filed for the groups.

## Gates per group

**Groups 1–3**: `pnpm check`, `TURBO_FORCE=1 pnpm check-types`,
`TURBO_FORCE=1 pnpm test`, `pnpm build --force`, `pnpm check:bans`,
`pnpm check:diagnostic-xref`, `pnpm check:next-marker`. Turbo gates are
forced because this repository's cache is shared across worktrees: an
unforced run can replay another worktree's logs, and "the gates passed
here" stops being a true sentence (#448). A gate is quoted with its own
summary output; `Cached: 0 cached, N total` is what makes it evidence.

**Group 4 additionally**: `pnpm changeset status`, `pnpm check:crap`,
and `pnpm check:tasktime` (all three also need `TURBO_FORCE=1`; run
plain, `check:crap` fails on cache replay as if the gate were broken),
plus the check CI actually makes — that the regenerated `README.md` is
**committed**.

Those three belong only here, and the reason is worth stating: **they
are not checks, they are generators.** `check:crap` recomputes the
README's CRAP block, `check:tasktime` re-renders its badges from
`openspec/task-times.csv`, and CI then runs `git diff --exit-code --
README.md` — it is testing whether the regenerated output was committed,
not whether the code is sound. `README.md` and `task-times.csv` are
group 4's files, so groups 1–3 cannot satisfy these without violating
file ownership, and #472 will certainly move the CRAP numbers (it
deletes ~120 lines across ten files and adds a helper). Likewise
`changeset status` cannot pass before 4.1 writes the changeset. A
handoff tag is not a PR: **README being stale at an intermediate tag is
correct, not a defect**, and these gates are not judgement input for
groups 1–3. Naming them here is what keeps that from looking like an
oversight later.

Note the late-failure shape: CI runs both README gates on a single
matrix leg (`node-version == 24`), so getting this wrong surfaces long
after the work looks green locally — at PR time, the most expensive
moment.

Plus, for every group, the proof obligation above: the output comparison
against `e95a268`, reported with its positive control.

**Verification is never a task.** The gates are the definition of done
for a group, not lines to tick.

## Clock stamps, not recall

Each task's start and end is a `date -u` run **at that moment**, reported
as the pair. "About 8 minutes" reconstructed afterwards is not a
measurement. The planner writes the differences into
`openspec/task-times.csv` when a group completes.

**Who ticks the boxes.** This file belongs to no group, so: the
implementer never edits it, the planner ticks a task only **after the
group's review verdict passes**, and that edit rides the implementer's
next commit. Ticking before a verdict would put "this passed" into the
one file that is the progress record — a false entry in the only ledger
anyone reads. `task-times.csv` is written at the same moment, but it is
group 4's file, so those rows land with group 4 alongside the README
refresh they invalidate.

## 1. The kind-change guards say what `change.kind` already carries

Closes #472. 31 guards restate `${change.kind} ${change.operation}` and
nothing else; the comment that justified keeping them per-file states a
premise the measurement disproves.

- [x] 1.1 [design] `~9m` Three helpers, with the message text pinned
      first. Red: `packages/core/test/kind/require-snapshot.test.ts` »
      "each helper renders the kind and operation message it replaces" —
      fails today because the helpers do not exist. Settles: the three
      names (`requireNext`, `requirePrevious`, `requireBoth`), that each
      returns the **narrowed non-null snapshot** rather than `void` so
      call sites keep their current shape, and that `requireBoth`
      reproduces `"… is missing its previous or next snapshot."`
      **byte-for-byte**. Before writing the helpers, extract all 31
      existing messages and confirm every one equals
      `${change.kind} ${change.operation} change is missing its
      {next|previous|previous or next} snapshot.` — **if even one
      deviates, stop and report**: a helper would then be changing user
      text, which is a contract change and ends this group. Capture, in
      the same test, **what is actually thrown across the full axis —
      every kind × every operation × three nullity shapes (both-null,
      previous-only, next-only)** — because both-null alone is not
      enough: it catches `grant`/`view`'s opposite orders but not the
      "only `next` is guarded" sites, where only a previous-only input
      reveals whether a guard was added. That execution recording, not
      the source strings, is the baseline (trap 2).
      **This test must assert, not just record.** A separate review-side
      harness already diffs the full axis across the handoff, but that
      one runs once and leaves the repository; it asserts only its own
      row count, so it would stay green if every message changed. The
      in-repo test is the permanent ratchet and needs **expected values
      written inline as string literals** — all 31 messages, and
      explicitly the both-null results for `grant`, `view`, `enum`, and
      `table`, the four sites where order or style is load-bearing. The
      point is future regressions: this change narrows 31 call sites down
      to 3 helpers, and those 3 become a single point of failure the
      moment nothing pins their output.
      **Pin the guard outcome, never the non-guard one.** A cell that
      throws never dereferences the snapshots, so its message does not
      depend on what a "present" dummy contains. A cell that does *not*
      throw does — it may return SQL carrying the dummy's values, or die
      in a `TypeError` — and none of that is #472's subject. So for
      non-throwing cells assert only "no `invalid-kind-change` was
      raised" and record nothing else; that keeps the test independent
      of dummy shape, which is otherwise a source of failures that look
      like guard regressions and are not. Files:
      `packages/core/src/kind/emit-helpers.ts`, the new test.
- [x] 1.2 `~9m` Absorb the guards in `enum-kind.ts` (3, incl. one
      `requireBoth` at `:79`), `function-kind.ts` (3), `grant-kind.ts`
      (4), `policy-kind.ts` (3). **No red test, honestly**: delegation
      changes no observable behavior, so any test that could go red here
      would be testing source text, not conduct. Writing one would be
      theatre. What protects this task is 1.1's pin test staying green
      across the edit, and 1.4's ratchet closing over all three files.
      Files: those four.
- [x] 1.3 `~8m` Absorb the guards in `rls-kind.ts` (3),
      `schema-kind.ts` (2), `sequence-kind.ts` (3),
      `trigger-kind.ts` (3). No red test, same reasoning as 1.2. Note
      these are four of the five "only `next` is guarded" kinds — do not
      let the symmetry tempt a new `requirePrevious` here. Files: those
      four.
- [x] 1.4 `~9m` Absorb the guards in `view-kind.ts` (4) and
      `table-kind-emit.ts` (3, incl. the second `requireBoth` at
      `:823`), and delete the disproved premise from
      `kind/emit-helpers.ts:29` ("…which differs per kind") — the
      comment is now false, and a false comment is worse than none.
      Red: **the group's only red test lands here — and what it proves
      is a structural fact, not correct behavior.** It is a ratchet
      asserting the `"invalid-kind-change"` literal no longer appears in
      `packages/core/src/kinds/*.ts`, i.e. that delegation is complete
      and cannot quietly creep back. It says nothing about whether the
      refactor preserved conduct; that is 1.1's pin test and the
      review-side execution diff. Describing it as proof of the refactor
      would be exactly the name-vs-assertion mismatch this change is
      watching for. It is red until the last of 1.2–1.4's sites
      delegates, so it gates the whole group rather than one file.
      **The directory scope is mandatory, not incidental** — say so in
      the test itself. The literal legitimately exists outside core's
      kinds: `packages/supabase/src/storage/bucket-kind.ts:225` and
      `examples/preset-smoke/src/preset.ts:108`/`:122`. Widening the
      ratchet "for consistency" breaks CI on three innocent sites.
      **Record why the asymmetry is correct**, or the next reader will
      try to remove it: presets *cannot* use these helpers, because that
      would require `@hejbro/core` to export them — a public API
      addition, the same contract trap as #473's registry. So the
      end state is deliberate: core kinds delegate, presets keep inline
      guards. Files: those two plus `emit-helpers.ts` and the test.

Group 1's output proof is an **execution** comparison, not a text one.
A baseline already exists, taken at `e95a268`: every registered kind ×
every operation × three nullity shapes (both-null, previous-only,
next-only) = 90 rows of actually-thrown code and message, recorded in
`~/hejbro-review-artifacts/td-pre-473/td-guard-messages-PRE.txt` by the
harness kept beside it. The same harness file is re-run on the handoff
tag and the 90 rows are diffed; **anything but a 0-byte diff fails the
group.** Source strings that match prove nothing on their own — trap 2
means a reordered pair of guards keeps every string and still changes
the output.

That baseline's coverage is itself established, not assumed: the run
produced 62 `invalid-kind-change` rows containing exactly **31 distinct
messages**, matching the 31 counted by source grep. No guard is beyond
the harness's reach, so an after-the-fact "it only sampled some of them"
objection does not apply.

The golden/migration comparison against `e95a268` must also be empty,
with its positive control.

## 2. One child-position registry instead of four restatements

Closes #473. Four purely-structural tables restate where an `ExprNode`
keeps its children. The registry stays **internal to `@hejbro/core`** —
it is deliberately not added to `packages/core/src/index.ts`, because
exporting it is the contract change this group refuses to make.

- [ ] 2.1 [design] `~10m` The registry, read and replace. Red:
      `packages/core/test/expr/expr-children.test.ts` » "every node
      kind reports its child expressions in render order, and rebuilding
      from them round-trips" — fails today because the module does not
      exist. Settles: the two names, the child **order** (render order,
      matching the existing tables), that the read returns a flat
      `ReadonlyArray<ExprNode>`, and that it is **not** re-exported from
      `index.ts`. This mirrors one level down the pattern
      `selectChildExprs`/`replaceSelectChildExprs` already proved at the
      select level.
      **"Every node kind" must be structural, never a hand-written
      list**: iterate `REACHABLE_NODE_KINDS` from
      `packages/core/test/expr/reachable-kinds.ts` so a new kind fails
      this test automatically. That file exists because this exact
      mistake was already made — its header records that
      `retarget.test.ts` and the D70 completeness test once kept
      separate kind lists, and `retargetTableRef`'s identity bug
      survived in the gap between them. A third independent list here
      would rebuild the very hole that module was created to close, in
      the same file it happened in. Files:
      `packages/core/src/expr/expr-children.ts` (new), the new test.
- [ ] 2.2 `~8m` Fold `walk.ts`'s two structural tables onto the
      registry — `someExprNodeHandlers` (`:73`) and
      `someDeepExprNodeHandlers` (`:162`), whose window entries are
      byte-identical to each other today. Red: extend
      `packages/core/test/expr/walk.test.ts` with a case that a new
      child position is seen by both walkers; it fails while each keeps
      its own table. Files: `packages/core/src/expr/walk.ts`.
- [ ] 2.3 `~7m` Fold `render-sql.ts`'s `collectColumnRefsHandlers`
      (`:189`). Red: `packages/core/test/expr/render-sql.test.ts` case
      that a child position reaches `collectColumnRefs`. Note this
      function feeds the RLS validators, so validator output identity is
      part of this group's proof. Files:
      `packages/core/src/expr/render-sql.ts`.
- [ ] 2.4 `~10m` Fold `retarget.ts`'s `retargetExprNodeHandlers`
      (`:589`) onto the replace half, keeping `retargetColumnRef`
      special — the same shape `retargetSelectNode` already uses at
      `:452-455`. This is the riskiest fold: the per-kind functions hide
      their child positions inside themselves, so the reference-identity
      property (an unrelated rename returns the *same object*) must
      survive. Red: `packages/core/test/expr/retarget.test.ts`'s
      identity loop over a node whose children moved — and that loop
      must assert with **`toBe`, not `toEqual`**. The property *is* "the
      same reference", so a structural-equality assertion passes on a
      freshly rebuilt clone and checks nothing that matters here; this
      one detail decides whether the test has any force. Add the
      reference assertion explicitly if the existing loop only compares
      shape. Files: `packages/core/src/expr/retarget.ts`,
      `packages/core/test/expr/retarget.test.ts`.

Group 2's output proof is a **surviving set, not a count**. Base
measurement at `e95a268`: adding one dummy single-child node kind to
`ExprNode` produces compile errors in **12** places.

**Do not key that comparison on `file:line`.** This group *removes*
code, so every surviving site below the deletions shifts upward, and a
line-keyed diff reports untouched sites as "disappeared" plus "newly
appeared" — the judgement drowns in false positives. The stable key is
**file + handler type name + count**: tsc names the table's type in its
own message (`… required in type 'RenderExprHandlers'`), which survives
relocation. The count belongs in the key because `walk.ts` holds
`SomeExprNodeHandlers` **twice**, and collapsing those two to one hides
exactly what #473 is about. Fold the per-package repetition of
`query/src/compile/params.ts` (reported once per dependent package)
before keying. Both sides run through the same extractor.

Judgement is three-part, and a matching total is not enough — "folded
three structural tables and wrongly folded one codec map" also totals 9:

1. **These 8 must all survive**, or something the plan excluded was
   folded: `codec.ts` × `DecodeExprNodeHandlers`, `EncodeExprNodeHandlers`,
   and the `NODE_KIND_TO_SNAPSHOT` map; `render-sql.ts` ×
   `RenderExprHandlers`; `walk.ts` × `ScopeViolationHandlers`;
   `test/expr/reachable-kinds.ts`'s exhaustive list;
   `query/src/compile/params.ts`;
   `supabase/…/rls-uncached-auth-call.ts` × `ChildrenOfHandlers`.
2. **Exactly one site outside that list may be new** — the registry's own
   table. Its path and type name cannot be known in advance, so the check
   is "exactly one unexpected site", not a name match.
3. The 4 that must vanish: `walk.ts` × `SomeExprNodeHandlers` (**both**),
   `render-sql.ts` × `CollectColumnRefsHandlers`, `retarget.ts` ×
   `RetargetExprNodeHandlers`. Total lands on **9**; **below 9 is
   suspicion, not success**, and above 9 means the fold is incomplete.

**The golden corpus cannot see task 2.4, so it does not count as that
task's proof.** All 14 cases in `packages/core/test/golden/cases` and
all 9 committed `examples/postgres` migrations run declaration →
migration; **none of them exercises a rename**, and rename is the only
path through `retargetExprNode`. Breaking 2.4 outright would still leave
the golden comparison at 0 bytes. The one existing rename check
(`examples/cli-smoke/test/e2e.test.ts:305-319`) is a `some(text => …)`
containment assertion over a single-column rename, not a byte golden.

So group 2's output proof is **golden 0 bytes _plus_ a retarget baseline
at 0 bytes**, the latter taken by running `applyRenameSpecs` over a real
example snapshot and recording: the generated rename SQL, the resulting
`KindChange`s, the full post-retarget object tree, and — the part
nothing else covers — the **reference-identity row per object**.
That last one is the property at risk: `engine/rename/retarget.ts:276`
records that `retargetExprNode` returns *the same reference* for an
unchanged node, and that identity is an **output gate, not an
optimization** — lose it and the engine re-encodes fields that did not
change. A fold that rebuilds nodes unconditionally flips those rows and
nothing else in the suite notices.

**Know what neither baseline can see.** The example corpus contains 10
of the 15 node kinds; `not`, `plpgsqlRef`, `rawSql`, `selectExpr`, and
**`window`** never occur in it. So the split is: a child list that is
*missing* is caught by the compile probe (the mapped type demands every
kind), but a child list that is *wrong* is caught by nothing here — a
registry returning `[fn, ...partitionBy]` for `window` and silently
dropping `orderBy` compiles clean, and no golden or retarget row moves.
`window` is both the most complex node (three child groups) and the
issue's own headline example, so this is the likeliest place to be
wrong. That gap is closed in-repo by 2.1's exhaustive iteration, not by
these baselines; the baselines deliberately stay measurements of real
artifacts rather than of invented ones.

**The probe re-measurement is the reviewer's step, not the
implementer's.** It is a gate, and gates are never tasks; the
implementer neither holds the probe patch nor should build one. A
substitute probe, however careful, makes the pre and post
incomparable — which is the whole reason the patch is kept byte-identical
across both runs.

Re-measure with the **byte-identical probe patch** used for the base run,
in the same order (`pnpm build --force` again after applying the probe,
then `TURBO_FORCE=1 pnpm check-types --continue`) — skipping the rebuild
lets downstream packages read a stale `dist` and under-report by three
sites; dropping `--continue` stops after core and misses them too. If the
probe no longer applies, that means this group touched `ast.ts`, which it
does not own: **stop**, do not hand-craft a substitute probe. A pre and a
post measured with different probes are not comparable.

## 3. `examples/` exercises the query layer from the user's seat

Closes #474. Measured at base: `db(`, `pgDriver`, `.over(`, `related(`,
`.references(` each appear **0 times** across `examples/` (positive
control: `table(` matches 8 times, so the search can match). The
fastest-growing surface has no user-viewpoint usage anywhere.

- [ ] 3.1 [design] `~7m` **Runs first, before group 1.** Measure
      whether `.references()` and the long `extras.foreignKeys` form
      render **byte-identical** SQL for one existing example FK. This is
      the plan's one task with no red test, deliberately: it is a
      measurement whose outcome decides whether task 3.4 exists at all.
      If identical, converting the example schema is a refactor and 3.4
      proceeds. **If not identical, stop and report** — the conversion
      would rewrite a committed migration, which is not a refactor and
      leaves this change. Report the rendered SQL of both forms
      verbatim, not a verdict. Files: none (measurement only).
- [ ] 3.2 `~9m` A reporting query, declared and compiled from the user's
      seat. Red: `examples/postgres/test/query.test.ts` » "the reporting
      query compiles to the expected SQL and parameters" — fails until
      the query exists. Uses **only already-exported** surface (a join
      plus an aggregate plus a window); adding API is out of scope and
      would make this a contract change. Stays a pure in-process test so
      `pnpm test` still needs no Docker. Files:
      `examples/postgres/src/reporting.query.ts` (new), the new test.
- [ ] 3.3 `~9m` The same query actually executes against Postgres. Red:
      the roundtrip-style script gains a step that runs the query
      through `pgDriver` against the Docker instance and asserts rows —
      fails until `@hejbro/pg` is a dependency of the example and the
      step exists. Real execution rides the existing `roundtrip` script,
      **not** `pnpm test`: requiring Docker for `pnpm test` would change
      the contributor contract. Files: `examples/postgres/package.json`,
      the example's roundtrip step.
- [ ] 3.4 **BLOCKED — 3.1 measured "not byte-identical", so this task's
      precondition failed.** Awaiting the lead's scope call; not started.
      Measurement: the two forms render the same SQL except that
      `.references()` drops the ` on delete cascade` clause entirely.
      The cause is structural, not incidental —
      `types/column-builder.ts:397` states in its own doc comment that
      `onDelete`/`onUpdate` "stay on the `extras` path", and
      `dsl/table.ts:1243-1244` hard-codes `onDelete: null, onUpdate:
      null` for the `.references()` fold. **All 7 FKs in
      `examples/postgres` carry an `onDelete`** (two also carry
      `onUpdate`), so there is no FK in the example that could convert
      cleanly. Converting any of them rewrites a committed migration:
      a contract change, not a refactor, and therefore out of this
      change by the rule this plan opens with. **The dependency runs one
      way**: the conversion is not blocked *by this change's scope*, it
      is blocked on the DSL itself. `.references()` would have to learn
      `onDelete`/`onUpdate` first; converting before that extension does
      not "change formatting", it **silently discards referential-action
      semantics** — both `onDelete` and `onUpdate`, since
      `column-builder.ts:64` gives `references` no options argument at
      all. The migration would stop emitting those clauses and nothing
      would say so. Note the knock-on:
      `related()` was to be demonstrated here, so it stays
      undemonstrable in `examples/` until this is resolved separately —
      3.2's scenario deliberately does not depend on it.
- [ ] 3.5 `~7m` Record the limitation 3.1 uncovered in the cheatsheet,
      citing the follow-up issue number. This documents behavior that
      already exists, so it is not a contract change; it is included
      because the cheatsheet teaches `.references()` first while saying
      nothing about the limit, and that limit excludes **all 7** FKs in
      `examples/postgres`. Red: none — a docs line has no test; its
      correctness is that it matches measured behavior. **Two things the
      wording must get right, both verified in source:**
      - The gap is **both** referential actions, not just deletes.
        `types/column-builder.ts:64` types `references` as a bare thunk
        with no options argument at all, and `dsl/table.ts:1243-1244`
        hard-codes `onDelete: null, onUpdate: null`. Write "referential
        actions", not "`on delete`".
      - **The two forms are mutually exclusive per column** —
        `dsl/table.ts:1205-1207` rejects a column that uses
        `.references()` *and* appears in an extras foreign key, with
        `invalid-duplicate-foreign-key` ("the constraint would emit
        twice"). So the line must say: a column needing referential
        actions uses the **extras form only**, and drops `.references()`
        for that column. Phrasing it as "add extras alongside" would
        teach code that throws.
      Files: `skills/hejbro/references/dsl-cheatsheet.md`.

## 4. Closing record

- [ ] 4.1 `~9m` One `patch` changeset (groups 1 and 2 both touch
      `@hejbro/core`; the five published packages are a fixed group, so
      naming one moves all five); **two** follow-up issues filed under
      #412 via the issue script — (i) everything in this repository that
      restates a core fact and cannot be folded without a public core
      export: the two traversal tables (supabase `ChildrenOfHandlers`,
      query params-lift) **and** the snapshot guards that presets and
      examples must keep inline because `requireNext`/`requirePrevious`/
      `requireBoth` are core-internal (`supabase/src/storage/
      bucket-kind.ts:225`, `examples/preset-smoke/src/preset.ts:108`,
      `:122`). One issue, because it is one decision: whether core
      publishes these helpers as extension surface; (ii) `.references()`
      cannot
      express referential actions. Issue (ii) is filed as an
      audit-grade surface finding, not a gap note: its body leads with
      "the form the cheatsheet teaches first covers **0 of the 7** FKs
      in `examples/postgres` — every one carries `onDelete`, one also
      `onUpdate`", carries 3.1's diff verbatim, and cites the structural
      cause (`types/column-builder.ts:64`'s options-free thunk and
      `:397`'s own doc comment, `dsl/table.ts:1243-1244`'s hard-coded
      nulls). It must also record that the obvious workaround is closed:
      `dsl/table.ts:1205-1207` makes the two forms mutually exclusive
      per column, so this is not "use the other form for the action
      part" but a genuine either/or; and (iii) the golden corpus has no
      rename case — 0 of 14 golden cases and 0 of 9 committed example
      migrations exercise `--rename`, so a user-facing CLI capability
      has no byte-level coverage and the only check is a containment
      assertion in `examples/cli-smoke`. Found while building group 2's
      proof; it is a coverage gap, not this change's to fix. Issue (ii)
      also records why
      it is not being fixed now: extending the surface is proposal work,
      and the 0.2.0 gate is not being widened. Both are shaped so the
      owner can promote them to a change on return. Then
      `README.md` badges refreshed (`pnpm check:crap`,
      `pnpm check:tasktime` — both need `TURBO_FORCE=1`, since a plain
      run replays cross-worktree cache and fails as if the gate were
      broken). Files: `.changeset/`, `README.md`.
- [ ] 4.2 `~6m` Close #472 quoting the `29 → 31` correction **with the
      command that measured it** and the note that the two combined-
      message guards were preserved rather than split; close #473
      citing follow-up (i); close #474 citing follow-up (ii) and stating
      plainly that 3.4 was measured impossible rather than skipped. Every
      residue leaves this change owning an issue number. Files: none
      (issue operations).
