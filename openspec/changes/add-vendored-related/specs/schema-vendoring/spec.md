## MODIFIED Requirements

### Requirement: An existing table crosses the boundary
A vendored contract SHALL emit an existing table — one the schema
declares with `existingTable()` — under `Tables` with the same `Row`,
`Insert`, and `Update` derivation a managed table gets, and its client
metadata SHALL mark it existing. The name-keyed client SHALL expose it
for reading like any other table, and a managed table's foreign key
onto it SHALL resolve to a relation in the contract exactly as one onto
a managed table does; a foreign key onto a table the schema does not
declare at all keeps having none.

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

## ADDED Requirements

### Requirement: The contract names the relations the client can follow
Each vendored table SHALL carry a `Relations` map in the generated
`Database` interface — relation key to `{ target, mode }`, `target` the
`Tables` key of the related table and `mode` `"one"` for a relation the
table's own foreign key points along, `"many"` for one another table's
foreign key points back along — computed when the contract is emitted,
by the same rules the query layer's `related()` derives with: a
single-column foreign key whose column key ends in `Id` yields a forward
relation under the stripped key; a single-column foreign key from
another carried table onto this one yields a reverse relation under that
table's `Tables` key; a key that would be both, or that names one of the
table's own columns, is omitted; a composite foreign key and a foreign
key onto a table the contract does not carry yield none.

The name-keyed client's type layer SHALL offer `.related(spec)` on the
whole-table select of every table whose map is non-empty, and on no
other table:
each requested key adds a field to the row — the target's `Row` or
`null` for `"one"`, `ReadonlyArray` of the target's `Row` for `"many"` —
a key outside the map fails to type-check, and the result chain keeps
exactly the stages the declaring side's own related chain has --
`.where()`, `.orderBy()`, `.limit()` -- and no others: the client offers
no stage the declaring repository's chain lacks, and `.offset()` after
`related()` exists on neither. The statement SHALL be
the one the declaring repository's `related()` compiles for the same
spec, so a scoped handle (`client.as(context)`) applies its context to
the nested reads as it does to the row itself. A contract emitted before
this map existed SHALL still build a client, on which the type layer
offers `.related` for no table; the chain the client forwards keeps its
own `unknown-relation`/`ambiguous-relation` guards for a JavaScript
caller that reaches past the types.

#### Scenario: A forward relation reads one parent
- **WHEN** a vendored `posts` table has a single-column foreign key
  `author_id` (key `authorId`) onto vendored `users`, and the consumer
  calls `client.posts.select().related({ author: true })`
- **THEN** the program type-checks with `author` typed as `users`'s `Row`
  or `null`, and the awaited rows carry the parent row under `author`

#### Scenario: A reverse relation reads many children
- **WHEN** the consumer calls `client.users.select().related({ posts:
  true })` over the same contract
- **THEN** `posts` types as `ReadonlyArray` of `posts`'s `Row`, and the
  awaited rows carry the children under `posts`

#### Scenario: A key the contract does not name is refused
- **WHEN** the consumer requests a key that is not in the table's
  `Relations` — a misspelling, a composite foreign key's column, a
  relation onto a table the contract does not carry, or a key the emit
  omitted for colliding with a column
- **THEN** the program fails to type-check; a JS caller reaching the
  runtime is refused with `unknown-relation` or `ambiguous-relation`
  exactly as on the declaring side

#### Scenario: A table with no relation has no member
- **WHEN** a vendored table's `Relations` is empty, or the contract was
  emitted before `Relations` existed
- **THEN** the type layer offers no `.related` member on its select
  chain, and the client still builds

#### Scenario: The nested read is scoped like the row
- **WHEN** the consumer follows a relation through `client.as(context)`
- **THEN** the compiled statement is the declaring side's own for that
  spec, sent after the context's `set_config` calls, so the nested rows
  are read under the same role and claims as the parent rows
