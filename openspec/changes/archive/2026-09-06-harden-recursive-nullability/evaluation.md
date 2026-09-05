# D106 evaluation — harden-recursive-nullability (round 1)

reviewer: context-free session, model fable
date: 2026-09-06
checkout: detached worktree at `upstream/dev` 30564a60 (the change is merged), `pnpm install --offline` + `pnpm build --force`

## Method

Only the delta (`npx openspec show harden-recursive-nullability --diff`, capability
`query-type-inference`) and the public surface were read: the `hejbro` barrel,
`@hejbro/query`'s type exports and the built `.d.ts` files, and the CTE section of
`skills/hejbro/references/query-layer.md`. No proposal/design/tasks, no `.blackbox/`,
no implementation source, no test files.

Two axes, both against the built packages:

- **Type axis** — probe files compiled with `tsc --noEmit` (strict, `exactOptionalPropertyTypes`)
  from a scratch package whose `node_modules` was the workspace's own. Each key was
  classified `NONNULL` / `NULLABLE` / `UNKNOWN` / `OTHER` by exact-type comparison
  (`[A] extends [B]` both ways) against the anchor's declared read type. Observation
  surfaces tried for the "outward row type": `SelectResult<{k: typeof r.k}>` (default
  second argument), `SelectResult<{k: typeof r.k}, never>` (a tracked, empty
  left-joined set), the awaited `handle.with(...)`, and `handle.execute(withCte(...))`.
  67 key-level type assertions across 7 probe files.
- **Server axis** — the same statements executed through `db(schema, pgDriver(...)).with(...)`
  against a fresh `postgres:17` container (`d106-rn-pg`, port 55630) over a
  three-level tree (`nodes` 1→2→3, `extras` row for node 2 only) so a left join
  misses at depth 3. 19 executions (17 distinct shapes; 6 of them server refusals,
  each expected and recorded with its SQLSTATE).

Input table (anchor / recursive term), every row run on both axes:

| # | anchor key | recursive term projects the key as | type (tracked) | server rows |
|---|---|---|---|---|
| T1 | `notNull` column | same column, inner joins only | NONNULL | no null |
| T2 | `notNull` column | `notNull` column of a **left-joined** table | NULLABLE | null at depth 3 |
| T3 | `notNull` column | `coalesce(notNull, nullable)` (family fallback) | NULLABLE | no null |
| T4 | `notNull` column | `over(firstValue(col), …)` window | NULLABLE | no null |
| T5 | nullable column | `notNull` column | NULLABLE | null at root |
| T6 | `notNull` column | set operation (`unionAll`), inner joins only | NULLABLE | no null |
| T7 | `jsonArrayFrom` / `jsonObjectFrom` | set operation projecting the same nested reads | array NONNULL, object NULLABLE, `id` NULLABLE | `kids: []`, `parent: null` |
| T8 | `jsonArrayFrom` / `jsonObjectFrom` | plain term with the same nested reads | array NONNULL, object NULLABLE, `id` NONNULL | `kids: []`, `parent: null` |
| T9 | `bigint` notNull / `$type<"a"\|"b">` notNull | `coalesce(bigint,bigint)` / same column | `bigint \| null` (anchor's type kept) / `"a" \| "b"` NONNULL | `10n…`, no null |
| T10 | — | `self` inside the callback, T2 shape | NONNULL both keys | — |
| T11 | non-recursive `w.as`, `notNull`/nullable columns | — | NONNULL / NULLABLE (unchanged) | null only on the nullable column |
| T15 | — | key set missing one anchor key | refused (`@ts-expect-error` consumed) | — |
| T17 | `notNull` column | set operation whose **left branch left-joins** | NULLABLE | null at depth 3 |
| T7u | nested reads | set operation with `union` (not ALL) | type-checks | `42883 could not identify an equality operator for type json` |

## Blocking findings

None.

## Non-blocking findings

1. **The rule is observable on exactly one public surface, and the delta does not name it.**
   Every execution surface a user actually reads rows through returns every CTE key as
   nullable (or untyped) regardless of this change: the awaited `handle.with(...)` reads
   `id: number | null` for T1's non-null anchor key (the `#942` boundary the skill names,
   the delta does not); `SelectResult<{k: typeof r.k}>` with its default second argument
   does the same for a non-recursive `w.as` reference; `handle.execute(withCte(...))`
   resolves every key to `unknown`. The delta's "a key non-null in both branches stays
   non-null" and "the reference inside the recursive callback still shows the anchor's
   non-null type" are therefore only falsifiable through `SelectResult<P, TLeftJoined>`
   with a *tracked* second argument — a type parameter the skill's own `SelectResult`
   paragraph (query-layer.md §"widening") never mentions. Not a contradiction: the
   sentences hold there. But a reader of the spec has no stated route to observe them.
2. **"A plain set operation does not do this — its result keeps the left branch's
   projection unchanged" is true of core-built set operations only.** The chain surface
   (`handle.select(...).union(handle.select(...).leftJoin(...))`) reads the key as
   `string | null` (measured, T13/T14), exactly as the base requirement *Set-operation
   branches must be row-compatible* already promises ("nullable in EITHER branch SHALL be
   nullable"). The delta's sentence is unqualified; as prose in the requirement body it
   contradicts the neighbouring requirement for one of the two surfaces.
3. **Cross-family divergence on a shared key is not caught either** (neighbour; the delta
   is silent, the base requirement *A same-family type divergence… is not caught* speaks
   only of same-family). Anchor `name: nodes.name` (text) with recursive `name: nodes.id`
   (integer) type-checks and reads `string` — the server refuses it (`42804 UNION types
   text and integer cannot be matched`, measured). The stated "compatibility test = same
   key set" makes this per-spec, but the same-family requirement's framing ("nothing at
   the family level … can tell") reads as if a family-level check existed.
4. **Skill wording, minor.** query-layer.md says the recursive branch offers "no further
   chain of combinators" and that `intersect`/`except` "can't even be spelled here". Both
   `.unionAll(a).unionAll(b)` and `.intersect(other)` *inside* the recursive term
   type-check, render parenthesised (`union all (… intersect …)`), and run on
   `postgres:17` — Postgres accepts a nested combinator in the recursive term; only the
   top-level combinator is restricted. The sentence is right about the top level and
   overstates the rest. Behaviour matches Postgres; the doc is what overreaches.
5. **Over-widening is prescribed, and it shows.** T3/T4/T6 type nullable while the server
   never produced a null in these shapes. Each is exactly what the delta prescribes
   (family fallback, windowed projection, untracked set-op set), so this is consistency,
   not a finding against the delta — recorded so the trade-off is visible.

## Scenarios verified

| Requirement / scenario | Type axis | Server axis |
|---|---|---|
| *The recursive-term reference is typed from the anchor* — The recursive term sees the anchor's columns | PASS (T10: `self.id: number`, `self.name: string` in the T2 shape) | n/a |
| — A recursive term missing one of the anchor's keys is refused | PASS (T15) | n/a |
| — A field computed differently on each side is accepted (window → nullable, anchor's type) | PASS (T4: `string \| null`) | PASS (runs; no null in this data — widening prescribed) |
| *Recursive-term nullability is elided, and the residue is stated* — nullable recursive key reads nullable outward, `self` still non-null | PASS (T2 + T10) | PASS (T2: `name: null` at depth 3) |
| — a key non-null in both branches stays non-null | PASS (T1, T8 `id`, T9 `kind`) | PASS (no null) |
| — set-operation recursive term: column / non-nested expression reads nullable | PASS (T6, T7 `id`, T17) | PASS (T17 null arrives; T6 none — prescribed) |
| — set-operation recursive term: nested read keeps its own nullability | PASS (T7: array NONNULL, object NULLABLE) | PASS (`kids: []`, `parent: null`) |
| — a key nullable in the anchor is nullable outward whatever the recursive term projects | PASS (T5) | PASS (null at root) |
| — anchor's *type* kept, null added (brand / bigint / numeric) | PASS (T9: `bigint \| null`, `"a" \| "b"`, numeric-mode `string \| null`) | PASS (`10n`, no null) |
| — `union` with json in the recursive term | type-checks | server refuses `42883` (expected) |
| Non-recursive CTE unchanged | PASS (T11) | PASS |
| `self` type unaffected by the recursive term's projection | PASS (T10) | n/a |

## Verdict

**ARCHIVE.** No delta sentence contradicts the built packages' behaviour on either axis.
The non-blocking items are about where the rule can be seen (1), one unqualified prose
sentence that is false for the chain surface (2), and two neighbours the delta never
claims (3, 4).
