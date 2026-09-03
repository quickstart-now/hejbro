# Proposal: add-offset-and-distinct

## Why

An ORM that cannot paginate is not an ORM yet. `SelectNode` is
`projection / from / joins / where / orderBy / limit` and that is the
whole surface, so `.limit(10).offset(20)` — the most common read idiom
in any application — cannot be written. Keyset pagination is the right
default for a large feed and the wrong requirement for an admin list.

`distinct` is missing for the same reason: a join that fans out has no
way to collapse, so the caller de-duplicates in JavaScript over rows the
database should never have sent.

`distinct on` is the one that decides this is a *Postgres* ORM. It has no
portable equivalent, it is the idiomatic way to take the latest row per
group, and pushing it to the `sql` escape hatch would mean the builder
covers only what every database can do — the opposite of the product's
own premise.

Neither is tracked by #416 (aggregates and window functions) or #417
(CTEs): those compute over rows, these decide which rows come back, and
they are more basic than either.

## What Changes

- **`offset`** on the select chain and the core builder, after `limit`
  and also on its own (a bare `offset` is legal SQL), plus a whole-set
  `offset` on a set operation exactly where `limit` already sits. Row
  counts stay inline, never bind parameters — `limit`'s existing rule,
  now enforced by one shared validator so the two cannot drift on what
  they accept.
- **`distinct()` / `distinctOn(...columns)`** on the stage `select`
  itself returns, and only there: SQL allows `distinct` only between
  `select` and the projection, so the chain allows it first and exactly
  once. A placement Postgres would reject is not expressible.
- **Snapshot format 8.** Both add fields to `SelectNode`, which is
  serialized as a view's body.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-builder`: the pagination and de-duplication requirement, and
  the row-count validation rule stated once for both clauses.
- `snapshot-format`: version 8, and what a serialized select records.

## Impact

- **Affected code**: `packages/core` (`expr/ast.ts`,
  `expr/render-sql.ts`, `expr/codec.ts`, `query/select.ts`,
  `snapshot/snapshot.ts`, the barrel), `packages/query`
  (`db/chain.ts`), `skills/hejbro`, both examples' committed chains,
  and the golden snapshots.
- **Breaking**: the format bump. Every existing snapshot is refused with
  the older-format diagnostic and its pin-or-reset guidance — loudly, by
  design.
- **Decision log**: no new row. The inline-row-count rule and the
  loud-version-skew rule are both existing decisions; this applies them.

## The format bump, and why now

The published format is 5 (`hejbro@0.1.1`); dev is on 7; 0.2.0 has not
shipped. Whatever version 0.2.0 lands on is the first one any user sees,
so a pre-release field addition costs nothing externally — this is the
cheapest moment there will ever be to make it.

It is not free in-repo, and the cost is worth stating because it is
exactly what a user will pay after release: every committed snapshot and
every migration banner hash had to be regenerated (both examples, 12
migration files, 15 goldens). That is the manual work #413 exists to
remove, seen from the inside.

Any further pre-release `SelectNode` growth — #416's `groupBy`/`having`
is the one in flight — should extend 8 in place rather than bump again.
The first addition after 0.2.0 ships is the one that pays the real price.

## Out of scope

Table aliases (and therefore self-joins) are the third gap #437's
measurements name. They need alias identity threaded through projection,
join and condition resolution rather than one more clause on the node,
so they are their own change.
