## ADDED Requirements

### Requirement: Two carried tables with one SQL name are refused at emission
`Tables` and the client metadata are keyed by the table's SQL name
alone, so a contract carrying two tables of one SQL name in different
schemas cannot be well formed: the type carries a duplicate key, the
metadata keeps whichever came last, and a relation onto the pair names
a key that is not defined. The emitter SHALL refuse such a contract
before any file is written, under a coded diagnostic that names every
colliding SQL name with each of its schema-qualified tables in identity
order. The collision is decided on the exact SQL name: two names that
differ only in case are two names. Function keys are not affected —
they are export names, and *Every emitted key compiles* owns them.

The remedy differs by command, so each has its own code. `vendor` has
no schema filter (*The schema filter is reserved, not silently
ignored*), so its way out is the declaring repository's: the export
must carry one table per SQL name. `pull` reads the schemas its
`--schema` flags name, so its way out is to drop one of them. This
requirement is scoped to emitting the contract from a payload already
obtained; it is not a twelfth member of *Each way vendoring can fail is
named separately*, whose enumeration covers obtaining and checking a
vendored schema and whose scope `pull` never enters.

#### Scenario: vendor refuses the Supabase layout
- **WHEN** the resolved export carries `existingTable("auth", "users")`
  beside a managed `app.users` and `hejbro vendor` runs
- **THEN** it fails with `vendor-table-name-collision`, the message
  names `users` with `auth.users` and `app.users`, says the schema
  filter is reserved and that the export must carry one table per SQL
  name, and no vendored file and no lock is written

#### Scenario: pull refuses and names its filter
- **WHEN** `hejbro pull --db-url <db> --schema a --schema b` reads a
  table `widgets` in both schemas
- **THEN** it fails with `pull-table-name-collision`, the message names
  `widgets` with `a.widgets` and `b.widgets` and says to drop one of the
  schemas from `--schema`, and no vendored file and no lock is written

#### Scenario: Every collision is named at once
- **WHEN** the carried tables hold `users` in three schemas and
  `widgets` in two
- **THEN** one diagnostic names both SQL names, each with all of its
  qualified tables, in identity order

#### Scenario: Names that differ only in case are not a collision
- **WHEN** the carried tables are `a.Users` and `b.users`
- **THEN** the contract is emitted with both keys

#### Scenario: A unique-name layout is unchanged
- **WHEN** every carried table's SQL name is unique across the carried
  schemas
- **THEN** the emitted contract is byte-identical to the one emitted
  before this requirement

## MODIFIED Requirements

### Requirement: An existing table crosses the boundary
A vendored contract SHALL emit an existing table — one the schema
declares with `existingTable()` — under `Tables` with the same `Row`,
`Insert`, and `Update` derivation a managed table gets, and its client
metadata SHALL mark it existing. The name-keyed client SHALL expose it
for reading like any other table, and a managed table's foreign key
onto it SHALL resolve to a relation in the contract exactly as one onto
a managed table does; a foreign key onto a table the schema does not
declare at all keeps having none. These sentences hold for a table
whose name is unique among the carried tables — `Tables` is keyed by
the SQL name alone, so two carried tables sharing a name across schemas
(an existing `auth.users` beside a managed `app.users`) are refused
before the contract is written (*Two carried tables with one SQL name
are refused at emission*).

Following that relation from the client is the name-keyed client's own
`.related()` (the requirement *The contract names the relations the
client can follow*): a managed table's relation onto an existing table
SHALL be followable exactly as one onto a managed table is, and the
nested rows SHALL type as the existing table's declared columns.

No code reads that mark today — the client already treats every
vendored table as existing, and whether a relation resolves is decided
when the contract is emitted, not when it is read. The mark is carried
for the reader of the generated file and for tooling built on it.

#### Scenario: A consumer reads a platform-owned table
- **WHEN** a schema declaring `auth.users` with `existingTable()` and a
  managed table referencing it are vendored, and the consumer reads
  both tables through the vendored client
- **THEN** the contract carries the relation to `auth.users`, and rows
  of the existing table read through the client type as its declared
  columns

#### Scenario: A consumer joins a platform-owned table
- **WHEN** the same schema is vendored and the consumer reads the managed
  table through the vendored client with `.related({ <key>: true })`
  naming the relation onto `auth.users`
- **THEN** each row carries the parent row under that key, typed as
  `auth.users`'s declared columns or `null`, and the statement is the
  same correlated subquery `related()` compiles on the declaring side

#### Scenario: An undeclared table still has no relation
- **WHEN** a managed table references a table the schema neither
  manages nor declares with `existingTable()`
- **THEN** the contract carries no relation for that reference, as
  before
