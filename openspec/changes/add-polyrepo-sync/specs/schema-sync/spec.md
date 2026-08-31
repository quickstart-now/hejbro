# schema-sync (delta)

## ADDED Requirements

### Requirement: A repository obtains a schema it does not own from the database
hejbro SHALL provide a `sync` command that reads the newest manifest row
from a database and writes one TypeScript module describing that schema.
The connection SHALL be taken from an explicit URL argument, then from
the environment variable the other connecting command reads, and when
neither is present the command SHALL fail with a coded diagnostic rather
than attempt a default.

The module SHALL be the command's only output. `sync` SHALL NOT write a
snapshot, a migration, or anything else that belongs to a repository
holding migration authority.

#### Scenario: A schema arrives as one module
- **WHEN** `sync` runs against a database whose newest manifest row
  describes a schema
- **THEN** one module is written describing that schema, and no other
  file is created or modified

#### Scenario: No connection is a coded failure
- **WHEN** `sync` runs with neither the URL argument nor the environment
  variable set
- **THEN** it fails with a hejbro-coded diagnostic naming what to supply

### Requirement: A synced module is a function of the row it was made from
Two syncs against the same manifest row SHALL write byte-identical
modules. The module SHALL therefore contain no value derived from a
clock, from the machine, or from the order in which the command happened
to read anything.

Without this, a repository that re-syncs sees a change where the schema
has none: the freshness check would pass on the stamp while the file
churned, and a continuous-integration job that re-syncs to compare would
report noise as news.

#### Scenario: Two syncs of the same row are byte-identical
- **WHEN** `sync` runs twice against the same manifest row, the first
  run's output discarded
- **THEN** both runs write byte-identical modules

#### Scenario: The module names no clock
- **WHEN** a synced module is written
- **THEN** neither its header nor its body contains a timestamp or any
  other value that changes between runs

### Requirement: A synced module holds no migration authority
The module `sync` writes SHALL contain no call that yields a declaration
carrying migration authority: its tables come from a usage constructor
that cannot produce one. Generating migrations from a synced module
SHALL fail with a coded error naming the module's origin and what to do
instead.

The refusal SHALL rest on the absence of authority in the values
themselves, not on the file's name, its location, or any marker a user
could add or remove.

#### Scenario: Generating from a synced module is refused
- **WHEN** a synced module is used as the declaration entry point and
  migration generation runs
- **THEN** generation fails with a coded error and writes nothing

#### Scenario: The module yields no authority-carrying declaration
- **WHEN** a synced module's exports are inspected
- **THEN** none of its tables carries migration authority, and the
  module contains no call to the declaration constructor that would
  confer it

#### Scenario: Querying through the module is unaffected
- **WHEN** a query is built and compiled against a synced module
- **THEN** it compiles to the same SQL the same query built against the
  owning repository's declarations produces

### Requirement: A synced module reproduces the consumer-visible type layer
Types read through a synced module SHALL equal the types read through
the declarations the manifest was made from. Five properties carry
across and each is observable: a result row's keys are the declared
TypeScript keys rather than the SQL column names; an array column's
element nullability follows the declared constraint; a numeric column's
visible type follows its declared mode; a relation key derived from a
foreign key matches the owning repository's, in both directions; and an
enum column types as its declared values rather than as a string.

#### Scenario: Result keys match the declaring repository
- **WHEN** a table whose TypeScript keys differ from its SQL column
  names is read through a synced module
- **THEN** the result row's keys are the TypeScript keys

#### Scenario: Element nullability matches the declaring repository
- **WHEN** an array column declared with non-null elements is projected
  through a synced module
- **THEN** its element type is not widened with null

#### Scenario: Numeric mode matches the declaring repository
- **WHEN** a numeric column declared with a non-default mode is
  projected through a synced module
- **THEN** its visible type is the type that mode selects

#### Scenario: Relation keys match the declaring repository in both directions
- **WHEN** a relation is traversed through a synced module from the side
  that holds the foreign key, and from the side that does not
- **THEN** both keys are the ones the owning repository's declarations
  produce

#### Scenario: Enum columns keep their values
- **WHEN** an enum column is projected through a synced module
- **THEN** its type is the union of the declared values

### Requirement: Type brands do not cross the boundary
A `$type` brand narrows a column's visible type in the declaring
repository only. A manifest SHALL NOT carry brand information, and a
column that is branded in the declaring repository SHALL surface through
a synced module as the type it would have without the brand — for a
`json` or `jsonb` column, `unknown`.

This is the same answer an unbranded column already receives, so a
consumer is never told a narrower type than the boundary can support.

#### Scenario: A branded column reads as its unbranded type
- **WHEN** a `jsonb` column carrying a `$type` brand is projected
  through a synced module
- **THEN** its type is `unknown`, exactly as an unbranded `jsonb` column
  projected alongside it

### Requirement: Role names travel with the module and the consumer opts in
A synced module SHALL export the role names the manifest carries, in the
branded form the execution context requires, and a consumer SHALL supply
them through the existing opt-in on the database handle. Supplying them
SHALL make exactly those roles usable and no others; not supplying them
SHALL leave the existing rejection in force.

#### Scenario: Supplied roles are accepted
- **WHEN** a consumer passes the module's exported role names to the
  database handle and requests a context naming one of them
- **THEN** the context is accepted

#### Scenario: A role outside the exported set is still rejected
- **WHEN** a consumer passes the exported role names and requests a
  context naming a role that is not among them
- **THEN** the request is rejected as it is for any unknown role

#### Scenario: Omitting the roles leaves the rejection in force
- **WHEN** a consumer does not pass the exported role names and requests
  any context
- **THEN** the request is rejected, and the diagnostic lists the roles
  that are declared on the handle

### Requirement: A synced module carries its freshness stamp as a value
The module SHALL export the identity of the manifest row it was made
from, as a value, so that a reader obtains it by importing the module
rather than by reading the module's source. Any human-readable marking
in the file is in addition to that value, never instead of it.

#### Scenario: The stamp is importable
- **WHEN** a synced module is imported
- **THEN** the identity of the manifest row it was made from is
  available as an exported value

### Requirement: Freshness is judged by comparison, never by hashing at run time
A freshness check SHALL compare the stamp the module exports against the
manifest rows in the database and count the rows that follow the
matching one. It SHALL NOT compute a hash while doing so, so that it
remains usable from a startup path that may not read files or reach
platform APIs.

A freshness failure SHALL state only what was observed — which manifest
row the module was made from, which row is newest, and how many rows lie
between them. It SHALL NOT name a cause it did not observe.

#### Scenario: A stale module fails with a counted distance
- **WHEN** a consumer's module was made from a manifest row that two
  later rows follow, and the freshness check runs
- **THEN** it fails, naming both rows and the distance between them

#### Scenario: A current module passes
- **WHEN** the module's stamp matches the newest manifest row
- **THEN** the check passes

#### Scenario: The failure claims no cause
- **WHEN** a freshness failure is reported
- **THEN** its text states the rows and the distance, and asserts
  nothing about why the schema moved

### Requirement: Each way a manifest can fail a reader is named separately
A reader of a manifest meets four distinct situations, and SHALL report
each with its own code and its own remedy. Three of them are failures
this requirement owns: the database has no manifest table; the table
exists but holds no row; and the table holds rows but none matches the
module's stamp. The fourth — a matching row with newer rows after it —
is the counted distance owned by the requirement on judging freshness by
comparison.

Each demands a different action, which is why one code cannot serve
them. An absent table means emission was never enabled in the owning
repository. An empty table means it was enabled and no migration has
been applied since. An unmatched stamp means the module was made from a
history this database does not have — a different database, or one whose
manifest rows were removed — and re-syncing is a decision, not a repair.
A database that has never carried a manifest is not a stale one, and
reporting it as "behind" would send a reader to re-sync against a
database that has nothing to give.

#### Scenario: A database with no manifest table says so
- **WHEN** the freshness check or `sync` runs against a database with no
  manifest table
- **THEN** it fails with the code for an absent manifest, and the remedy
  names enabling emission in the owning repository and generating

#### Scenario: An empty manifest table says so
- **WHEN** the manifest table exists and holds no row
- **THEN** it fails with its own code, distinct from both the absent
  table and a stale module

#### Scenario: A stamp with no matching row says so
- **WHEN** the module's stamp matches no row in the manifest table
- **THEN** it fails with a code distinct from a counted distance,
  because no distance can be computed

#### Scenario: The four codes are four
- **WHEN** the same reader meets an absent table, an empty table, an
  unmatched stamp and a matched stamp with newer rows after it
- **THEN** it reports four different codes

### Requirement: The command can check without writing
`sync` SHALL accept a mode that performs the freshness comparison and
reports it without writing the module, so that a continuous-integration
job detects a stale module without producing a change of its own. Its
exit status SHALL distinguish agreement from staleness.

#### Scenario: Checking leaves the module untouched
- **WHEN** `sync` runs in check mode against a stale module
- **THEN** it reports the staleness, exits non-zero, and the module on
  disk is unchanged

#### Scenario: Checking a current module succeeds quietly
- **WHEN** `sync` runs in check mode and the module is current
- **THEN** it exits zero and writes nothing

### Requirement: The schema filter is reserved, not silently ignored
`sync` SHALL accept a schema-filter argument and SHALL refuse it with a
coded error stating that filtering is not yet supported. Accepting it
silently would let a caller believe a filter applied when the whole
manifest was written.

#### Scenario: The reserved filter is refused
- **WHEN** `sync` runs with the schema-filter argument
- **THEN** it fails with a coded error stating that the filter is not
  supported, and writes nothing
