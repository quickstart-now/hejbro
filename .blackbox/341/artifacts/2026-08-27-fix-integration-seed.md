Refs:
- packages/pg/test/integration.test.ts @ blob 84262e6e72de16e7f5c1fd7f89d4afdc99ffe1c2
- packages/pg/test/driver.test.ts @ blob 8a1dce14ca70a81bea6a4b9df82a286afae1b277

# fix-integration-seed — the typed insert() seed and the first raw grammar capture (#341)

Plain-cycle test change (no production code, no changeset), executed by
the lead session directly in worktree `fix-integration-seed` off dev
`ce43ab5`, rebased onto `26893d9`. Second item of the post-harden defect
queue; #341's own body ordered it after both harden groups (landed) and
before #342.

## Owner inputs (English rewrites)

The owner approved the queue order #336 → #341 → #342 with #337/#339
free (see `2026-08-27-fix-crap-gate.md` for that exchange). Mid-piece
the owner asked why the lead was working these without summoning a
piece team — whether it was because the items are simple. The
assistant's answer, recorded: the piece-team convention (D5) binds to
OpenSpec tasks.md groups, these are plain-cycle fixes with no live team
to re-task (the #338 precedent was a re-deployment of the then-living
hg3 team, and all three harden teams were fully TaskStopped); the
trade-off is the loss of an independent reviewer, compensated by
self-applying the team disciplines (isolated cache + --force +
`Cached: 0` citation, red/green, mutation validity, blackbox); and the
largest remaining defect, #337, is the reasonable place to resummon a
team if the owner prefers — default remains lead-direct.

## What the change proves that the old file could not

The old seed went through raw `driver.execute` parameters, citing a
`MutationValue` gap (#322) that #345 dissolved — so the workaround's
stated reason no longer existed, and the repository held zero captured
samples of Postgres's actual output grammar (every anchor was
hand-written, one of them misnamed "raw Postgres text").

Recorded gap proof (the red the old file cannot produce): with
`serializeInterval` mutated (`days` → `dayz`), the OLD test stayed
green — the write path was invisible to it. Mutation validity was
confirmed live (the integration config aliases `@hejbro/*` to source,
so the package-boundary-mutation-void trap did not apply — checked
before trusting the green, per the hg3 standard).

The new file seeds two rows through `insert().values()` — the second
row negative and mixed-sign-across-axes (year-month and time axes
negative, day axis positive; negative elements inside array literals) —
and closes with `::text` captures asserted as exact strings. Under the
same `dayz` mutation the new test goes red at the serializer pin; under
a broken array delimiter (`,` → `;`) the REAL SERVER rejects the
literal (`invalid input syntax for type bigint: "123;456;789"`) — the
two reds that prove (a) and (c) are now server-anchored. Write value =
read value is asserted directly (`toEqual(insertedDuration)`), and the
mixed row's zero fields assert the parser's (D) `+0` normalization live
(vitest's `toEqual` distinguishes `-0`).

## Measured server grammar (postgres:17, IntervalStyle 'postgres')

One prediction was corrected by the capture itself: array-element
quoting is per-element and space-triggered — `{-00:05:00,"-3 days"}`
arrived with the pure time-axis element unquoted next to a quoted
day-carrying one (the assistant had predicted both quoted). Also
recorded: `1 year` singular at 1, zero axes elided, explicit `+3 days`
after a negative group, `.000000` fractions dropped. The always-full
write forms are pinned beside the captures, so the file now records the
exact input-vs-output difference the "server parses a normalized
variant of its own output grammar" rationale rests on.

`serializeInterval`'s doc comment still calls owner decision (D)
"pending" — stale since #345 landed the parser's `plusZero`
normalization; deliberately left for #342's PR, where the shared
inverse property test will prove the round-trip claim that comment
makes (comment expiry rides with the evidence, not ahead of it).

## Gates

Integration suite green (2 rows + 4 raw-grammar assertions), mutations
A/B red then reverted (`git diff` clean on core), biome 406 files
clean, check-types 13/13 `Cached: 0`, test 14/14 `Cached: 0`, CRAP
0/1182 via the freshly-merged `check:crap --force` (`Cached: 0` — the
#336 fix's first real use), README block unchanged.
