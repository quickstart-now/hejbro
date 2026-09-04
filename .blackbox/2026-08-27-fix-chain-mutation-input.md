Refs:
- packages/query/src/db/chain.ts @ blob af46d2525fcb40c909cab2d6efb31dc31070def1
- packages/query/src/types/insert-input.ts @ blob 2a252ac93d888d7b40ee935f0a1d263d27207f56
- packages/query/test/types/chain-mutation-input.test.ts @ blob 8a30ecdb9a3a815d7bb84d608573ebf6293e946c
- packages/query/test/types/insert-input.test.ts @ blob 626142a9c51202f4f402c4661a13dceb7adecad8
- packages/query/test/types/inline-inference.test.ts @ blob f2f2ec5b565a14106d5a45b9e0bb92e7f6e0ba44

# fix-chain-mutation-input — the chains consume the input types the spec promised (#337)

Plain-cycle bug fix (restores the main spec's "Insert and update input
types follow the declaration" requirement at the chain surface — no
proposal, no spec sentence moved), executed by the lead session
directly in worktree `fix-chain-mutation-input` off dev `d750082`.
Fourth item of the post-harden defect queue; the largest of the five,
and the one the lead had named to the owner as the natural place to
resummon a piece team — the owner did not redirect, so the stated
default (lead-direct) held.

## Owner inputs (English rewrites)

Covered by the queue-order approval and the mid-piece "why no team?"
exchange recorded in the two previous entries; no new owner decisions
were required. No spec sentences moved (checked against
`openspec/specs/query-type-inference/spec.md` before starting — the
requirement text already mandates exactly this behavior, which is what
makes the fix plain-cycle).

## The defect, measured before fixing

`chain.ts` took core's `MutationRow` (every key optional, explicit
`null` accepted everywhere) at all three mutation entry points:
`.values()`, `.set()`, and `onConflictDoUpdate`'s `set`. The red run
(a new chain-surface type test with `@ts-expect-error` on each claimed
rejection) drew the exact gap map: five directives unused — missing
required key (single-row and per-row-in-multi-row) and explicit `null`
on a `notNull` column (values, set, and onConflict set) — while
unknown-key and raw-jsonb rejections were already guarded by
`MutationValue`'s own arms. The fix therefore had to add key discipline
and null discipline without touching the value contract.

## The fix and one discovery

Wiring alone was not enough: `InsertInput`'s value arm predated the
harden change and had already fallen behind the spec — it consumed the
read-side `ColumnTsType`, so it accepted a raw `jsonb` object (the
spec says `json`/`jsonb`/`bytea` accept only an `Expr`) and accepted
no `Expr` anywhere (the `sql` escape hatch would have been rejected on
every column). Wiring that stale shape into the chains would have
broken the escape hatch while "fixing" the keys. `InsertColumnValue`
is now core's own `MutationValue` with the `null` arm `Exclude`d for
`notNull` columns — one write-value contract to drift against, key and
null discipline layered in query. The three chain sites swapped to
`InsertInput`/`UpdateInput`; the implementation pass-through to core's
builders compiled with zero casts (the chain types are strict
narrowings of `MutationRow`, so assignability held structurally).

Core's own `insert()`/`update()` builders deliberately keep
`MutationRow`: the low-level multi-row surface's "missing key = SQL
`default` marker" semantic is a feature there, and core cannot import
query's key logic without inverting the dependency.

## Fallout absorbed

The standalone `insert-input.test.ts` had pinned the stale value arm
(raw `Payload` objects in valid-row fixtures, brand-typed value
assertions); it now pins the `MutationValue`-based unions, spelled as
concrete `Expr` literals in the test — never via `MutationValue`
itself, per the link-axis rule ("an equality assertion whose both
sides route through the same symbol cannot verify that symbol").
`inline-inference.test.ts`'s InsertInput propagation axis gained the
`Expr` arms with its mode-resolution point (bare `string`, never the
collapsed tri-union) intact. Family literals were read off the
factories, not guessed: `serial`/`bigint` → `"numeric"`, `json`/`jsonb`
→ `"json"`, arrays → `"array"`. check-types 13/13 confirmed zero
downstream breakage (cli, examples included) — the strictened surface
rejected nothing legitimate anywhere in the repo.

## Gates

check-types 13/13 `Cached: 0` (every `@ts-expect-error` consumed —
the red list's five gaps all enforced) · test 14/14 `Cached: 0` · CRAP
0/1182 `Cached: 0` · biome 409 clean, all re-run on the final bytes
after biome's import sort touched `chain.ts` (gate judgment binds to
bytes, not to intent). No changeset: the #344 precedent — the pending
minor×5 release already covers `@hejbro/query`.
