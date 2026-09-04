Refs:
- packages/query/test/types/array-roundtrip.test.ts @ blob aa1ed3e8d84df85acbe77a3df2262b938987a292
- packages/core/src/types/interval-serialize.ts @ blob b71b9622ea7dc6b8d9f5d8fb49151c1bd4d69e95

# fix-array-roundtrip — the shared inverse property the parallel groups deferred (#342)

Plain-cycle test change (one comment-only production edit rides along;
no changeset), executed by the lead session directly in worktree
`fix-array-roundtrip` off dev `9741769`. Third item of the post-harden
defect queue, sequenced after #341 per that issue's own priority note.

## Owner inputs (English rewrites)

Covered by the queue-order approval recorded in
`2026-08-27-fix-crap-gate.md`; no further owner decisions were needed
in this piece. One new defect found mid-piece was filed first and
reported after, per the owner-accepted issue-first pattern (#349,
below).

## What the change proves

The array-literal grammar's two halves were deliberately built
file-disjoint during harden-query-layer (writer in core's
`serializeArrayLiteral`, parser in query's `parseArrayText`), each
pinning its own corners, nothing proving they stay inverse. The new
single-place property test asserts `parse(write(xs)) = xs` over a
hand-curated corner table plus a 256-sample deterministic `hash32`
sweep (mirroring `interval-serialize.test.ts`'s own precedent — no
property-testing library exists in the monorepo, and one file is not a
reason to add one), and `write(parse(s)) = s` for canonical strings
including, verbatim, the two server-measured captures #341 landed —
which is what lets `write ∘ parse` treat real server output as
already-canonical.

The writer is reached through the public pipeline (`insert().values()`
→ compile → the bound literal-text parameter), not a deep import —
`serializeArrayLiteral` is deliberately absent from core's barrel and
the vitest alias policy forbids deep source paths; the compile route
tests the writer *as deployed* in the only path that ever runs it.

Mutation validity (the red a passing-by-construction property cannot
show): dropping the writer's `/^null$/i` quoting branch reddened the
corner table AND the sweep independently (sample 23); renaming the
parser's `NULL` token check reddened the null-element cases from the
other side. Both reverted; `git diff` clean before commit.

## The defect the test found before it ever ran (#349)

The write path's type rejects what the property must cover: `tsc`
refuses `(string | null)[]` for a `text().array()` column
(`MutationValue` → `readonly string[]`), and the read side is the same
lie in the other direction — `BaseTsType` maps `.array()` to
`ReadonlyArray<element>` with no `| null`, while Postgres arrays are
element-nullable always and both grammar halves handle the NULL token.
Filed as #349 (Bug, #282 gate) with fix direction left to the owner
(widen both types, or reject loudly at runtime); the test carries the
one deliberate mis-assertion at the cast site, commented with the
issue number, per the deliberate-mis-assertion discipline from g3.

## The comment-expiry rider

`serializeInterval`'s doc still carved out "negative time axis with a
zero-valued sub-field" as a round-trip exception "tracked separately
(owner decision (D) pending)" — stale since #345 landed (D):
`parseInterval` `+0`-normalizes every field, and the interval
round-trip property sweeps that exact region (its own comment records
the two formerly-excluded entries rejoining the domain). Expired here
per hg2's comment-expiry convention, riding the PR whose subject is
exactly round-trip evidence.

## Gates

Property test 18/18 (corner + sweep + canonical + idempotence), biome
408 clean, check-types 13/13 `Cached: 0`, test 14/14 `Cached: 0`, CRAP
0/1182 `Cached: 0`, README block unchanged.
