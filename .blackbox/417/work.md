# Work — quickstart-now/hejbro#417

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-ctes — WithNode, withCte()/handle.with(), recursion, and the D103 rule reused (#417)

_2026-08-29T00:00Z_

(Correction, 2026-08-29, lead session: seven of these pins were originally taken
mid-branch — before the rebase onto dev and the final review fixes moved
select.ts, with.ts, define-view.ts, design.md, tasks.md, README.md, and
task-times.csv — and the squash merge erased those intermediate blobs from
reachable history. They now pin the merged tree (65936ca). Refs must be taken
from the final tree, after any rebase; the neon-preset piece derived this
constraint independently the same day.)



Team piece (planner + implementer, researcher measuring in parallel,
reviewer relayed through the planner), worktree `feat-add-ctes` off dev
`34be0bd`. Third and last of #299's three changes (owner brainstorm
2026-08-28): set operations landed first because recursion needs `UNION`,
window functions second, CTEs last so each change settles its own
largest fork over already-landed terrain.

### What was built and why

`WithNode` lands as a new `QueryNode` variant (`{queryKind: "with", ctes,
recursive, body}`), never a field grafted onto `SelectNode` — the same
variant-over-field reasoning D103/D104 already used, reconfirmed here
rather than re-litigated. `select()`'s `from` parameter widens to accept
a CTE reference (`FromSource = Table | CteReference`) via a hidden
`cteRowMeta` brand dispatch, the `tableMeta` precedent. `withCte((w) => {
... })` is the core entry point; `w.as(name, query, options?)` declares
an entry and hands back a typed reference (`CteFieldRef` strips
`typeNode`/`sqlName` from the runtime object, not just the type, so a
CTE column can never be spelled where a real `ColumnRef` is required —
D105's "unrepresentable" tier applied to three of the six FK/index
guard sites, the other three staying reachable because their own
parameter type is a bare `Expr`/`Condition`). `withCte`'s escape name
exists because `with` is a reserved JS word; the query-layer chain
method (`handle.with(...)`, an object property, not a top-level
declaration) keeps the plain name — the same asymmetry `deleteFrom`
already carries for `delete`. `w.asRecursive(name, anchor, (self) =>
recursiveTerm, options?)` declares a recursive entry: the anchor fixes
the CTE's own row type (Postgres's own rule), and the recursive term's
own projection is checked for union-compatibility with the anchor rather
than exact identity — reusing D103's `SetOpResult`/`SameKeys` (moved
from `@hejbro/query` into `@hejbro/core`, since `asRecursive` lives in
core and core cannot depend on query) rather than inventing a second,
relaxed matcher. The recursive branch's own combinator surface is
narrowed to `union`/`unionAll` only, so the four measured postgres:17
rejections (whole-set `order by`/`limit`/`offset`, `intersect`/`except`
as the combinator) are unrepresentable rather than merely guarded.
Views, column ordering, the rename engine, and the Supabase RLS
validator all widen to see through a `WITH` wrapper to its real tables.
The recalled restriction list for a recursive term ("no aggregates, no
window functions, no `distinct`, no `group by`") is not in the
PostgreSQL manual and measured wrong on four counts — a window function,
`distinct`, `distinct on`, `group by`/`having`, and an aggregate in the
*anchor* are all accepted; only an aggregate at the recursive term's own
select level is refused, alongside the four unrepresentable shapes above
and the self-reference placement rules.

### What went wrong

1. **Two "measured" type-system claims were reported up, believed, and
   both had to be retracted or corrected before landing — for two
   different root causes.**

   **The first was a stale build artifact, not a real defect.** Early in
   group 3, `CteFieldRef`/`CteRowEnvironment` were "measured" to drop
   `OriginBrand` two ways: `Omit` over a generic type parameter, and
   plain `TProjection[K]` indexing. Both were reported up, believed, and
   acted on — the lead swept the repo for the same shape, found two more
   sites (`WindowFunctionCall`, `Aggregated`), and filed them (later
   closed, see item 2 below). Independent review reverted both "fixes",
   force-rebuilt `@hejbro/core`, and found every gate green — neither
   defect reproduced. Root cause: the original investigation read
   `packages/core/dist/index.d.ts` while it was stale relative to source,
   diagnosed the staleness correctly mid-investigation, but never
   re-derived the two findings made *before* that diagnosis from a clean
   build. The standing rule this earned: **a stale-artifact diagnosis
   invalidates every measurement taken before it — re-run them all, do
   not reason about which ones were affected.** A second lesson rode
   along: the regression tests written for the "defect" instantiated the
   type with concrete arguments, so they passed under both the buggy and
   the fixed form and pinned nothing — **a test that stays green when you
   restore the bug is not a pin.**

   **The second was a real contradiction, caught by the process working
   exactly as designed.** Group 6's first draft required a recursive
   term's projection to match its anchor's *exactly* — and that made this
   change's own motivating case (a window function in the recursive
   term) fail to type-check, because the anchor's field is a full
   `ColumnRef` and the term's is an `Aggregated`, structurally
   incompatible under an identity rule. The implementer stopped without
   narrowing anything, per the proposal's own escalation clause, and
   reported it rather than silently choosing a workaround. What settled
   it is worth more than the fix itself: **the answer was not a new rule
   but a second application of an existing one.** A recursive CTE is
   grammatically `anchor UNION [ALL] recursive-term`, so union
   compatibility already had an approved answer (D103's `SameKeys`), and
   inventing a relaxed matcher would have put two answers to one
   question in the codebase — the exact shape this change spent a day
   removing elsewhere (the `CteFieldRef` retraction above). Two pins
   landed so the relaxation reads as a contract, not an accident: a
   missing/extra key is still refused, and a field computed differently
   on each side is accepted.

2. **"The same rule" was a phrase that hid three different errors, not
   one.** Three separate times, a claim of the form *this is the rule we
   already have* turned out to share only part of the referenced rule,
   and each time review or a live measurement — not the original
   author — found the gap:
   - The type layer's own reach was first stated as uniform across all
     six FK/index/RLS guard sites; it actually closes three of six (the
     other three accept a bare `Expr`/`Condition`, not a `ColumnRef`,
     so they stay reachable regardless).
   - The brand-preservation fix was first attributed to `Omit`, the
     mechanism the retracted defect (item 1) had named; the actual,
     kept fix is a key-remapping mapped type, a different device that
     happens to look similar.
   - **The one that propagated furthest**: set-operation compatibility
     was said to share "the same rule" with a recursive CTE's
     anchor/recursive-term pair — true for the compatibility *test*
     (`SetOpResult`/`SameKeys`), false for the *result typing*. A plain
     union widens a mismatched column type (`int`+`bigint` → `bigint`);
     a recursive CTE refuses to (measured, `42804`). The wrong,
     broader claim was written into a spec delta, then into a lead
     approval condition as a required pin, before group 6 review
     measured it false against a real postgres:17 — by which point it
     had already gone through the planner, the lead, and one round of
     implementation. The standing lesson: **"the same rule" names a
     whole rule; if only part of it applies, say which part.**

3. **Caught before code, nine times — a count taken from the list, not
   from memory, after a hand-counted total was wrong twice elsewhere in
   this same change** (a stub-count miscount, corrected the same way):
   1. `dsl/table.ts` needed editing outside any group's stated file
      list.
   2. `index-builder.ts`'s `.on()` guard was only half the shape it
      needed to be (filed as #464 rather than silently left).
   3. Task 1.3c's own fix would have broken an existing, already-green
      red test if not sequenced around it.
   4. Task 2.5's own work was sequenced wrong — `defineView` could not
      accept a `WithNode` until task 4.1 landed.
   5. `with` is a reserved JS word, closing off a standalone
      `export const with` before any code was written for it.
   6. Task 3.1's own red test would not even type-check without task
      3.3 landing first — caught before either was implemented.
   7. The `typeNode` strip was not uniform across every projection
      shape the way an early claim stated.
   8. `asRecursive` required extending the already-shipped `CteBuilder`
      in `with.ts` — task 6.1's own file list had never named it.
   9. `SameKeys`/`SetOpResult` did not actually reach from
      `@hejbro/core`, undermining the planner's own stated premise for
      how the group-6 escalation should resolve.

4. **A witness guard was asserted in a comment, not proven — the same
   shape this change had already rejected once before.** Task 7.1's live
   witness set `alter database ... set statement_timeout` once in
   `beforeAll`, with a comment claiming every recursive test below was
   guarded against Postgres's own measured non-termination case
   (`r left join t`'s non-nullable side). It was not: `alter database`
   does not apply to the session that runs the ALTER itself, and pg's
   own `Pool` reuses that exact idle connection for its next query
   (confirmed down to the backend pid) — so the one connection every
   recursive test in the suite actually used was the one connection the
   guard never reached. Fixed with the `Pool` config's own
   `statement_timeout` option (a per-client default applying to every
   connection, the first one included), an assertion that `show
   statement_timeout` actually reports the set value, a second
   standalone test proving real cancellation (`pg_sleep` under a
   short-timeout pool dies `57014` — visibility and cancellation are two
   different claims, and the first had already stood in for the second
   once), and a second, timeout-independent guard layer (an explicit
   depth column) on the one case that genuinely cannot terminate on its
   own.

5. **The same review pass also caught a test whose own rendered SQL a
   real server refuses.** 6.5's "an aggregate inside a scalar subquery in
   the recursive term is accepted" test used the `sql` escape hatch for
   a subquery with no `from` clause; with every argument an outer
   reference, Postgres binds the aggregate to the *outer* level (the
   recursive term itself), not the subquery — exactly the `42803`-shadow
   case the design notes' own third boundary warning describes, and the
   opposite of what the test's name claims. Fixed to carry its own
   `from`, matching the actually-measured accepted form.

6. **Three people were looking at three different points in time of the
   same tree, and the resulting cross-talk cost real cycles — not one
   person's mistake.** `design.md` (the post-implementation enforcement
   figures, the two diagnostics' SQLSTATE table) and the
   `query-type-inference` spec delta (the anchor-typing correction, item
   2 above) were both planner-authored, landed directly in the working
   tree rather than sent as instructions. Each time they appeared as an
   unexplained diff, they were read as a concurrent researcher
   measurement instead (a real, distinct phenomenon this same session
   also had to handle correctly — `ast.ts` genuinely was mid-measurement
   by the researcher more than once, and was correctly left untouched
   each time) and left uncommitted, three separate times, despite two
   direct requests to commit them. Two things fed the repeated miss
   from the other side, not just the misattribution itself: the
   requests to commit arrived bundled inside messages that also carried
   approval of unrelated work and the next task's instructions, so the
   confirmation request itself was easy to lose among them; and a
   reviewer report calling the files "still uncommitted" was itself
   checked against a HEAD from *before* they had, in fact, already been
   committed — so by the time that report was relayed, it was already
   stale. The standing rules this earned, one per side: **an unexplained
   diff inside `openspec/changes/add-ctes/` is the planner's, gets
   committed in the next commit, and is only ever left alone when the
   planner says so explicitly**; and **a confirmation request that needs
   an unambiguous answer goes in its own message, not folded into one
   that also approves other work** — the same fix this change's own `cli`
   diagnostic exchange had already needed once before, recurring a
   second time here.

7. **A commit header habit collided with this repo's own lint rule three
   separate times, not once.** `commitlint`'s `subject-case: lower-case`
   rejects any capital letter anywhere in the subject, and three
   different commit headers in this change quoted a code identifier
   verbatim there — `DeclaredCteMarker`, `Omit`, `D105` — each rejected,
   each fixed the same way (rewritten as a lower-case descriptive
   phrase: "the declared-cte scope marker", "the retraction record",
   "the approved d105 decision rows"). Three occurrences of the identical
   failure, with the identical fix, is a pattern worth naming rather than
   three unrelated near-misses: a commit header quoting a real identifier
   needs a lower-case rewrite as a matter of course here, not a
   case-by-case discovery every time commitlint says so.

### What went right

- **The escalation trigger fired exactly as designed, twice** (items 1
  and the group-6 half of item 2 above) — the implementer stopped and
  reported rather than narrowing scope quietly or picking a workaround,
  which is what let both roads correct at the design layer instead of
  compounding in code.
- **A stale-`dist` false positive was caught by re-deriving from a clean
  build rather than trusting the original report**, and the resulting
  rule (re-run every measurement taken before a diagnosed staleness) is
  the kind of correction that pays for itself on the next change too.
- **`@types/pg` was checked (by the reviewer, directly) before the guard
  fix was written, rather than assumed** — the fix landed with the exact
  declared type in hand, no cast, no follow-up.
- **A "second, independent guard" instinct (the depth column) was applied
  even after the primary guard was fixed**, closing the actual class of
  risk (an unbounded query in a Docker-gated CI witness) rather than
  just the one incident that surfaced it.

### Gates

`pnpm check` (biome) clean · `pnpm check-types` 13/13 packages clean ·
`pnpm test` — core 89 files / 1186 passed + 1 todo, query 46 files / 662
passed, all clean · `pnpm --filter @hejbro/pg test:integration` 17/17
against a real postgres:17 (Docker), stable across repeated runs
including the new `statement_timeout`-cancellation and depth-guarded
recursion cases · `pnpm check:bans` clean (no `let`/`var`/loop
statements) · `pnpm check:next-marker` / `pnpm check:diagnostic-xref`
clean · `pnpm check:crap` 0/1467 functions over CRAP 5. One `.changeset`
(`minor`, `@hejbro/core`, fixed group moves all five packages, confirmed
via `pnpm changeset status`).

Migrated from the single-file entry `.blackbox/2026-08-29-add-ctes.md`, kept verbatim at `.blackbox/417/artifacts/2026-08-29-add-ctes.md`.

