# Proposal: narrow-join-nullability

Closes #307. Approved 2026-08-31, including every decision under
"Settled decisions" below.

## Why

`projection-declared-types` (#311) gave every projected declared column
its declared read *type* back and deliberately left one axis widened:
nullability. Today every object-projection field is `| null`, whatever
the declaration says:

| statement | field type today | what actually arrives |
|---|---|---|
| `select({ t: posts.titleRequired }, posts)` | `t: string \| null` | never null |
| `select({ t: posts.titleRequired }, posts).innerJoin(...)` | `t: string \| null` | never null |
| `select({ c: comments.bodyRequired }, posts).leftJoin(comments, ...)` | `c: string \| null` | genuinely null |

Only the third row is honest. The first two force `!` or a null check on
values the declaration already proved non-null, in exactly the statements
object projections exist to write.

The reason the widening was kept is recorded in `select-result.ts`: a
projection's type is fixed at `select()` time, `.leftJoin()` is chained
onto it afterwards, and the inference layer cannot see which tables were
left-joined. That is a *missing edge*, not an impossibility: `TableColumns`
already stamps every built column ref with `OriginBrand<TColumns, K>` (the
declaring column map and key), so a projected field's source is
recoverable; what is missing is the other half — the statement's
left-joined table set, which no stage type carries today
(`leftJoin(joined: Table, on: Condition)` is not even generic).

## What Changes

- **The select stages carry the left-joined table set.** `leftJoin`
  becomes generic in the joined table, and each select stage type (core's
  `SelectDistinctable`/`SelectJoinable`/…/`SelectLimited` and the chain's
  mirror of them) carries the accumulated set as a second, defaulted type
  parameter. `innerJoin` accumulates nothing — an inner join cannot null
  a row.
- **A projected declared column narrows to its declared nullability
  unless its source table was left-joined.** `SelectResult` takes the
  left-joined set as a second parameter and applies `| null` per field
  instead of unconditionally.
- **Only a direct column reference narrows.** Anything that merely
  *carries* the origin brand through — `min`/`max` (`Aggregated<TExpr> =
  Omit<TExpr, "exprNode" | "sqlName">` preserves the brand) and the
  window value functions `lag`/`lead`/`firstValue`/`lastValue`/`nthValue`
  — stays `| null`. Those are genuinely nullable regardless of joins (an
  aggregate over no rows, a partition boundary), so the discriminator is
  "is this value a column reference" (`exprNode extends ColumnRefNode`),
  never "does this value carry an origin brand". This is what makes the
  `add-window-functions` handoff hold: an offset function with no
  `default` keeps its `| null` after this change lands.
- **Untracked paths keep today's widening.** The new type parameter's
  default is "the left-joined set is unknown", which resolves exactly as
  today — so a nested read (`jsonArrayFrom`/`jsonObjectFrom`), a CTE
  body, `defineView`, and any hand-written `SelectResult<T>` stay wide
  rather than silently narrowing without the information to justify it.
- **Whole-table projections and `returning()` are unaffected** — they
  already carry declared nullability, and a whole-table projection is the
  statement's own `from` table.

## Capabilities

### Modified Capabilities

- `query-type-inference`: the requirement carrying the blanket widening
  is removed and split — its declared-type content continues as "Result
  types and their nullability are inferred from declarations", and the
  join rule `add-query-layer` removed when this axis was parked is
  restored as "A left join is what widens a projected field's
  nullability". The aggregate and window requirements are modified: each
  gains the statement (and a scenario) that its field stays nullable with
  no left join in the statement, which is where the `add-window-functions`
  handoff lands.

## Impact

- **Affected code**: `packages/core/src/query/select.ts` (stage types +
  generic `leftJoin`), `packages/query/src/types/select-result.ts` (the
  per-field rule), `packages/query/src/db/chain.ts` and
  `packages/query/src/db/db.ts` (`ExecuteResult`), plus
  `skills/hejbro/references/query-layer.md`.
- **Runtime**: none. No AST, no compiled SQL, no conversion changes —
  every gate's SQL goldens must diff to zero.
- **Breaking**: types narrow. A read type getting narrower is assignable
  to the wider annotation it replaces; the one visible break is
  `@ts-expect-error`-style code asserting a projected field *is*
  nullable, and hejbro's own tests are where that lives.
- **Changeset**: one, `minor` (the six published packages are a fixed
  group).
- **Decision log**: no new row — this executes a parked axis, it does not
  revisit a decision.

## Settled decisions (owner-approved 2026-08-31)

1. **Narrowing discriminator**: narrow only a direct column reference,
   for the reason above. The handoff being satisfied *structurally* is
   not enough on its own — a refactor could erase it silently — so it is
   ratcheted by its own spec scenario and type test.
2. **Table identity is structural.** `Table<TColumns>` carries no name at
   the type level, so "was this field's source table left-joined" is
   answered by comparing column-map types. Two structurally identical
   tables collide — and collide in the *safe* direction only (a field is
   widened that could have stayed narrow; a left-joined column can never
   be narrowed by a collision). The alternative, a table-name literal
   parameter on `Table`, is a core-wide change out of proportion to what
   it buys (D88). The limit is stated in the spec rather than hidden.
3. **The new type parameter's default is "unknown set" (widen), not
   "empty set" (narrow)** — an untracked caller must not narrow. An
   "empty set" default would turn every position this change does not
   reach into a false non-null promise. *How* that default is spelled was
   corrected during group 1, against a measurement rather than a
   preference: a literal sentinel makes "untracked" a **narrow** type, so
   a stage that does track its joins stops being assignable to any
   position annotated with the default (TS2379 at the chain's
   `makeJoinableChain`) — the sentinel defeated the back-compatibility the
   default exists for. The default is the top type, `unknown`, which
   restores that assignability and additionally makes `UntrackedJoins |
   <Table>` absorb back to untracked, so the fail-safe is a property of
   the type system instead of a matcher's special case. The decision
   itself (default means widen) is unchanged.
4. **Threading boundary**: core select stages, the chain stages, and
   `ExecuteResult`. Nested reads, `withCte`/CTE references, `defineView`
   and `related()` are explicitly out and stay wide — narrowing them is
   follow-up material, not this change. **Extended by one position
   during group 3** (owner ruling, exercised under standing delegation
   by the lead session, after the group 2 review): a `returning()`
   projection narrows as well. The boundary's own logic is
   "a position that cannot see the statement's joins must not narrow",
   and a mutation is not such a position — it has no join grammar to
   see, so its set is definitively empty rather than unknown. Leaving it
   widened would have been the one place this change kept a widening it
   had the information to remove.
5. **Self-join of the `from` table is not tracked** (over-widening side).
   Stated, not solved.

## Fallback if threading proves unworkable

If carrying a second parameter through the stage types degrades
inference or type-check time unacceptably, the fallback is a *binary*
rule: a statement with any left join keeps today's full widening, a
statement with none narrows every projected declared column. It needs no
table matching and is still honest, but it is a scope reduction and is
escalated, never adopted silently.
