Refs:
- openspec/changes/harden-query-layer/tasks.md @ blob 5a63fbd21e86bf7b2972840b20cf33903272cdad
- packages/core/src/types/column-builder-factories.ts @ blob 2dc5f2af5615266b13e45bf1b44796184effca03
- packages/core/src/types/numeric-mode-defaults.ts @ blob b868a31415ba8013ddbca0da63d29d7f17ad13ca
- packages/core/src/types/ts-type-map.ts @ blob 8e3cab5cc1140ed313dbb3bd552bd409a70cc073
- packages/core/test/column-builder.test.ts @ blob f0692ea93812acedc4a145019fa45c5cc5c65285
- packages/query/src/db/fn.ts @ blob 29722e6136e82a41d68051d9402b914f44309b38
- packages/query/src/db/transaction.ts @ blob cea0812aa88a5be9d6e7d228490a136c51195d94
- packages/query/test/db/context.test.ts @ blob 11e3ae1773462d1b47626c01e08e92e74631ea2c
- packages/query/test/db/execute-result-type.test.ts @ blob 0ef304b79f5f3070d96636e957012af12953a7ae
- packages/query/test/db/fn.test.ts @ blob c58a0deb26c288d891eb27c7226684a03871e3b1
- packages/query/test/types/chain-types.test.ts @ blob 28640652bae573866424b5a81d87c10021b4d0be

# harden-query-layer group 3 — tx.execute typing, deferred coverage, derived default modes

Piece team hg3 (planner opus, implementer sonnet, reviewer opus),
worktree `harden-g3-debt` off dev `0318d8a`, tracking issue #334,
ten team commits (tip `312829d`) plus this close-out. First-landing
group of the change: it carries the change's single `minor` changeset
(one changeset per change, riding whichever group lands first — the
owner-approved tasks.md settlement) and the group order hg3 → hg1 →
hg2 was chosen by the lead because hg3 finished with zero pending
items and landing it first voids its pre-defined rebase
re-verification set.

The owner had ruled the same day that 0.2.0 ships only when every
sub-issue of the phase issue is finished, feature-scope parkings
included — this change is the head of that path. Within the group the
lead settled three escalations before code: the stale "deliberate
asymmetry" assertion from the previous change is rewritten in place
(one case, coverage preserved) rather than deleted or left red; #310
closes on its core half only — the query-side mirror in `fn.ts` stays,
because unifying would demand exporting core constants publicly (a
permanent API for a boundary consequence), with the stale issue
reference in the comment corrected and a cheap drift guard added; and
no group authors a changeset, the lead places the one changeset by
landing order (parallel branches each adding one would fight the
"exactly one" gate nondeterministically).

## What landed

`Tx.execute` resolves `ExecuteResult<TStatement>` exactly as
`db.execute` does. The binding was achieved in `transaction.ts` alone
— one choke point, two inheriting creation sites — so `context.ts`
and `db.ts` are byte-unchanged, a fact the review pinned with content
anchors after the four-entry-point lesson of the previous change made
"both creation sites" the default expectation. The two branches the
execution piece had deferred (#315: the `fn.ts` unresolved-scalar
guard, the `context.ts` empty-roles message) got direct tests with
zero production lines. The default numeric modes moved to their own
constants module (`numeric-mode-defaults.ts`), factories and
`ts-type-map.ts` deriving via `typeof` with the C19 exhaustiveness
block byte-identical (#310).

## The review's real find: the link axis

After all planned mutations died, the reviewer probed one more:
severing only the `typeof` link between alias and constant — values
untouched — left tsc and the whole suite green, while the actual
behavior became the exact drift #310 exists to prevent (type `number`,
runtime `bigint`). The cause: every equality assertion routed both
sides through the same alias, so the link moved as a unit and the
assertions could not see it. Two lines pinning the derived types to
concrete types (`bigint`, `string`) closed it; the reviewer re-severed
both the bigint and numeric links to confirm red on each. Recorded as
a practice gap, not a person's: the mutation matrix distinguished
value-axis mutations but had no link-axis row, and both the planner's
instruction and the reviewer's own matrix shared the blank. Two
standards carried forward: (1) derived refactors need one assertion
pinning the derivation's result to something independent of the
derivation — and the tell is readable without running anything: an
equality whose both sides route through the same symbol cannot verify
that symbol; (2) mutation reports must specify their target down to
declaration-site vs use-site — the one apparent evidence mismatch this
group hit dissolved into wording ambiguity once the target was
specified, and the planner formally retracted the mismatch claim.

## Process notes

Estimates ran 3–7× over across all three tasks for one shared reason,
now priced: this repo has no vitest `typecheck` project, so
`expectTypeOf` is a runtime no-op and every type-assertion red/green
had to be measured by moving the assertion into a compiled path and
back. Task 3.2 cost more to prove than to write (9m vs 8m) — the first
recorded number for "the cost of already-correct code is proof, not
authorship". The A1 drift guard exceeded its 5-minute skip condition
(13m); the reviewer judged the artifact a valid observed-value guard
and the lead accepted it with the deviation recorded. `check:crap`
turned out to ignore `--force` (npm-script boundary) — `TURBO_FORCE=1`
is the working form, filed as #336. During this group's run the sibling
teams' reconnaissance also surfaced two pre-existing defects the lead
filed as phase sub-issues (#338 bare-inline factory inference collapse
— fix site is this group's file area, likely a follow-up piece for
this team; #339 select row-key case mismatch).
