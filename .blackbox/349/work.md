# Work — quickstart-now/hejbro#349

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-array-null-elements — array element types stop denying null (#349)

_2026-08-28T00:00Z_

Plain-cycle bug fix (the query-execution main spec already promises
"every `NULL` element is `null`" on arrival — the types lagged behind
the specified runtime; no spec sentence moves), executed by the lead
session directly in worktree `fix-array-null-elements` off dev
`59efb02`, owner direction "#349부터 처리해".

### The fix

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

### Evidence shape

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

### Gates

check-types 13/13 · test 14/14 · CRAP 0/1184, README block unchanged ·
biome 410 clean · pg integration 1/1 — every turbo gate `Cached: 0` on
an isolated cache; gates re-run on final bytes after biome's reflow of
the union. No changeset (#344 precedent; pending minor×5 covers the
packages).

Migrated from the single-file entry `.blackbox/2026-08-28-fix-array-null-elements.md`, kept verbatim at `.blackbox/349/artifacts/2026-08-28-fix-array-null-elements.md`.

