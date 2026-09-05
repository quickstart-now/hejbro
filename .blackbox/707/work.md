# Work — quickstart-now/hejbro#707

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — check's inventory axis extended to columns, indexes and check constraints

_2026-09-05T00:22Z · per R1_

Extended `hejbro check`'s inventory from table-only to object-level: a
column, index or check constraint the database holds on a managed
table and no declaration covers is now reported, one line per object,
informational only (no exit-code effect, no Finding). An index backing
a declared primary key or unique column is excluded (the declaration
already accounts for it under that constraint's own name); any other
backed index is reported and names the constraint it backs, read from
`pg_constraint.conindid` joined into the existing `indexes` query --
never inferred from a name match.

Found and fixed during this work: the initial `conindid` join matched
not only the constraint an index implements but also any foreign key
elsewhere in the schema that merely points at it (a FK's own
`conindid` names the *referenced* table's unique/primary-key index).
Unit tests never caught this -- they inject `constraintName` as a
fixture, so the query's own real behavior was untested -- but the live
witness against `examples/postgres` (a schema with real foreign keys)
showed every declared primary key misreported as backing an unrelated
FK. Fixed by restricting the join to `contype in ('p','u','x')`, the
only constraint kinds Postgres gives their own backing index.

