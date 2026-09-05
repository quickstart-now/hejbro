# Proposal: add-vendored-related (#653)

## Why

The name-keyed client a vendored contract's `createDb()` returns reads
one table at a time: `.where()`/`.orderBy()`/`.limit()`/`.offset()` and
nothing that crosses a foreign key. The contract already carries every
relation the declaring repository resolved — `Relationships` in the
generated `Database` interface and `foreignKeys` in `contractMetadata`,
both rendered from one computation (`contract/tables.ts`) — and the
client already reconstructs real `Table` values with those foreign keys
and feeds them all into one `db()` handle "so relation-following sees
every table at once" (`name-keyed-db.ts`). The one thing missing is the
member: `add-unmanaged-objects` (#605) promised that a consumer *joins*
a platform-owned table through the vendored client and had to narrow the
scenario to what exists, and the `schema-vendoring` spec now says in so
many words that "the name-keyed client exposes no `.related()` for any
table, managed or existing".

Measured while closing #654: the wrapper's underlying chain already
reaches every stage the `db()` surface has — surfacing `.related()` is a
matter of typing what the internal handle already does, not of building
a second query language (owner seal (가): one production and one
consumption repository speak one query language).

## What Changes

- **The contract emits the relation keys it already knows.** Each
  `Tables[name]` entry gains `Relations`, a map from relation key to
  `{ target: <Tables key>; mode: "one" | "many" }`, computed at emit time
  by the same rules `@hejbro/query`'s `related()` derives at runtime: a
  single-column foreign key whose column key ends in `Id` yields a
  forward `"one"` relation under the stripped key; a single-column
  foreign key from another carried table onto this one yields a reverse
  `"many"` relation under that table's own `Tables` key; a key that
  would collide — forward against reverse, or either against one of the
  table's own columns — is omitted, as the query layer's type excludes
  it. A foreign key onto a table the contract does not carry yields
  none, exactly as `Relationships` already drops it. `Relationships`
  and `contractMetadata` are unchanged.
- **The name-keyed select chain gains `.related(spec)`** on a table
  whose `Relations` is non-empty, typed from it: each requested key
  adds a nested field to the row — `Row | null` of the target for a
  `"one"` relation, `ReadonlyArray<Row>` of the target for `"many"` —
  and a key outside the map fails to type-check. The result chain keeps
  exactly the stages the declaring side's own related chain has —
  `.where()`, `.orderBy()`, `.limit()`. A table with no
  relations has no `.related` member at all, and a contract vendored
  before `Relations` existed builds a client on which no table has one —
  the same rule a pre-functions contract already follows.
- **Runtime is a forward, not a reimplementation.** `.related(spec)`
  delegates to the internal `db()` handle's own `related()`, so the
  compiled statement is the correlated-subquery form `related()` already
  documents, `unknown-relation`/`ambiguous-relation` keep their runtime
  guard for a JS caller, and the RLS context `client.as(context)` scopes
  applies to the nested reads unchanged.
- The two-repository witness gains the join against a real server; the
  polyrepo reference documents `.related()` on the vendored client; one
  `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`schema-vendoring`** — MODIFIED requirement: *An existing table
  crosses the boundary* (the client follows the carried relation; the
  scenario `add-unmanaged-objects` gave up returns). ADDED requirement:
  *The contract names the relations the client can follow*.

## Impact

- `packages/cli`: `src/contract/tables.ts` (the `Relations` map and its
  rendering, from the same `RelationshipEntry` computation), the
  contract emit tests and goldens, `test/two-repo.integration.test.ts`.
- `packages/query`: `src/client/name-keyed-db.ts` (`DatabaseShape`
  learns an optional `Relations`; `NameKeyedSelectChain` gains the
  conditional `related` member and its result chain type; the table
  client forwards), its type and runtime tests.
- `skills/hejbro`: `references/polyrepo.md` (and the `query-layer.md`
  cross-reference).

Independent of every change in flight: no file overlaps with
`add-config-driver`, `feat-snapshot-upgrade` or `harden-aggregate-vocabulary`.
