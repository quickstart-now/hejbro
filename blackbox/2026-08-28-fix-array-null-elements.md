Refs:
- packages/core/src/types/ts-type-map.ts @ blob 94baed4f522ac989a99e9e366cccf94477ee4b03
- packages/core/src/types/column-builder.ts @ blob e26b0bd375321bbfc2dccd2cea674ca339026c45
- packages/query/test/types/array-roundtrip.test.ts @ blob fa0dd2f278d22a8412dcb0dadac27f35de5ce25b
- packages/query/test/types/insert-input.test.ts @ blob 330a10aebd79bfbd0600eab7331f5c28a5f70d87
- packages/query/test/types/column-map.test.ts @ blob df430904a3a4b1d2ca3063abceb0f0daf9c11afb
- packages/query/test/types/select-result.test.ts @ blob e30760024cb5a40d581517c65c9a9e2edf28a999
- packages/core/test/inline-inference.test.ts @ blob 1697b9120e6e55a0868459daafba8be63afd469f
- packages/pg/test/integration.test.ts @ blob 077f32b3e41f0a2eac348b030e4ae8077ef8d199

# fix-array-null-elements — array element types stop denying null (#349)

Plain-cycle bug fix (the query-execution main spec already promises
"every `NULL` element is `null`" on arrival — the types lagged behind
the specified runtime; no spec sentence moves), executed by the lead
session directly in worktree `fix-array-null-elements` off dev
`59efb02`, owner direction "#349부터 처리해".

## Owner inputs (English rewrites)

1. The owner directed: process #349 first (before the feature track).
2. The assistant presented the fix-direction background (SQL semantics:
   Postgres arrays are element-nullable always, no DDL forbids it;
   Drizzle comparison; both options' full UX; spec/process cost of
   each) and asked (A) element types gain `| null` vs (B) keep non-null
   and fail fast. The owner chose (A), then interrupted to add: going
   (A) must come WITH usability improvements, not alone.
3. The owner supplied Drizzle context: Drizzle behaves like the lie
   version out of DX obsession and Prisma-legacy assumptions; its own
   issue #2656 acknowledges the incorrect inference but a fix is
   frozen by breaking-change fear, punting users to the unconstrained
   `$type` override.
4. The owner rejected "TS 5.5 filter narrowing is the consumption
   answer" as poor ergonomics and sketched dedicated surfaces instead:
   a chained declaration method (`.array().$notNullElements()` sketch)
   plus a runtime narrowing utility (`hasNoNulls(rows[0].tags)`),
   stating the bar: keep (A)'s honesty AND ship ergonomics that don't
   envy Drizzle. (Logged in dd-thinking's rejection log; the rule:
   "the standard library already handles it" is a floor, never the
   answer.)
5. Settled plan: #349 lands now as the type correction; the ergonomics
   package (CHECK-backed `.notNullElements()` — the assistant
   recommended dropping the `$` prefix since `$`-prefixed methods are
   the type-only convention and this one emits SQL — plus an
   honest runtime-checked narrowing utility) becomes its own Feature
   issue + OpenSpec change, accepted as +1 on the 0.2.0 gate.

## The fix

Two type-level edits, no runtime change (the runtime already handled
null elements on both sides — #342's property test and the writer's
NULL-token rendering prove it):

- `BaseTsType`'s array wrap: `ReadonlyArray<element>` →
  `ReadonlyArray<element | null>` (#349) — column-level `notNull` stays
  a separate axis (select-result's job).
- `ColumnReadType`'s array-brand branch: `ReadonlyArray<TBrand>` →
  `ReadonlyArray<TBrand | null>` — the brand narrows the ELEMENT; the
  null axis belongs to the array wrap, and the `$type` constraint is
  checked against the element's base BEFORE `.array()` wraps, so
  letting a brand strip the null would be exactly the unchecked lie
  the "narrowing only" guarantee (the codebase's stated safety
  difference from Drizzle's unconstrained `$type`) exists to prevent.

Because `MutationValue` reuses `ColumnReadType`, the write side
followed automatically — one edit moved both directions, and STRICT
("accepts exactly the declared read type") stayed literally true.

## Evidence shape

Red (genuine, 9 tsc errors on pre-fix code): removing #342's documented
deliberate mis-assertion (the exact site that discovered #349), six
flipped read/write pins across core and query type tests, and a null
element seeded through the typed builder in the pg integration test.
Green: all 9 resolved by the two mapping edits with zero unexpected
fallout (examples hold no arrays — measured before the decision round).
The integration run then witnessed the full circle against a real
postgres:17: `[-1, null, 42]` written through `insert()` (writer
renders the unquoted `NULL` token) and read back with `null` at the
same position — the execution spec's sentence, live.

## Gates

check-types 13/13 · test 14/14 · CRAP 0/1184, README block unchanged ·
biome 410 clean · pg integration 1/1 — every turbo gate `Cached: 0` on
an isolated cache; gates re-run on final bytes after biome's reflow of
the union. No changeset (#344 precedent; pending minor×5 covers the
packages).
