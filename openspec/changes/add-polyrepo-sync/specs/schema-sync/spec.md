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
enum column types as its declared values rather than as a string. The
relation property holds for edges whose target the manifest carries;
an edge pointing outside it is governed by its own requirement.

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

### Requirement: A synced module carries tables and enums, not functions
A synced module SHALL carry the schema's tables and the enums its
columns use. Function declarations SHALL NOT be emitted in this version,
so a consumer has no typed function surface from a synced schema.

Their export names travel in the manifest even so, which is what lets a
later version emit them without moving the manifest format — and moving
that format is the expensive event, because a reader that meets a
format higher than it knows refuses.

#### Scenario: A synced module emits no function declarations
- **WHEN** a schema declaring functions is synced
- **THEN** the module carries its tables and enums, and no function
  declaration

### Requirement: A reference to a table the schema does not own has no relation
A foreign key whose target is a table the owning repository declares as
pre-existing rather than managing SHALL produce no relation key in a
synced module, because the target is not in the manifest to be
reconstructed. The columns and the constraint are unaffected; only the
derived relation is absent.

#### Scenario: A relation to an unmanaged target is absent
- **WHEN** a table references a pre-existing table the schema does not
  manage, and the schema is synced
- **THEN** the referencing column is present and typed, and no relation
  key is derived for that edge

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
rather than by reading the module's source. That identity is the
snapshot hash the migration recorded — a value computed when the
migration was generated, carried through the manifest row, and compared
as a string. Any human-readable marking in the file is in addition to
that value, never instead of it.

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
A reader of a manifest meets six distinct situations, and SHALL report
each under its own code and with its own remedy. Four are failures this
requirement owns: the database has no manifest table; the table
exists but holds no row; the table holds rows but none matches the
module's stamp; and the newest row declares a manifest format higher
than the reader knows. The fifth — a matching row with newer rows after
it — is the counted distance owned by the requirement on judging
freshness by comparison. The sixth — an embedded snapshot format the
reader refuses — is owned by the requirement on format skew.

Six codes, because each remedy addresses a different actor: the owning
repository enables emission, applies a migration, or regenerates one;
the consumer re-syncs or changes its own hejbro. A situation reported
under another's code sends its reader to the wrong repository, and
leaves a caller branching on message text instead of on a code.

Each demands a different action, which is why one code cannot serve
them. An absent table means emission was never enabled in the owning
repository. An empty table means it was enabled and no migration has
been applied since. An unmatched stamp means the module was made from a
history this database does not have — a different database, or one whose
manifest rows were removed — and re-syncing is a decision, not a repair.
A manifest format higher than the reader knows means the reader is the
older version of hejbro, and the remedy is to change the tool, not the
schema. A database
that has never carried a manifest is not a stale one, and reporting it
as "behind" would send a reader to re-sync against a database that has
nothing to give.

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

#### Scenario: The six situations are told apart
- **WHEN** the same reader meets an absent table, an empty table, an
  unmatched stamp, a manifest format higher than it knows, an embedded
  snapshot format it refuses, and a matched stamp with newer rows after
  it
- **THEN** it reports six distinct codes, each carrying its own remedy

### Requirement: A manifest format higher than the reader knows is refused
Format skew is asymmetric, because the manifest format only ever gains
fields. A reader that meets a manifest format **higher** than it knows
SHALL refuse with its own coded error, naming the format it found, the
format it knows, and the remedy — a newer hejbro, not a re-sync and not
a schema change. A reader that meets a **lower** format SHALL read the
row and treat the facts that format does not carry as absent, exactly as
it treats any fact a manifest does not hold.

Refusing downward as well would couple the two repositories in the wrong
direction for a format whose changes are additions the reader can simply
not find.

What that asymmetry buys is exact, and no larger: independence across a
bump that moves **only** the manifest format — a sidecar gaining a fact.
It buys nothing across a snapshot format bump. The embedded snapshot's
version is governed by the snapshot reader's own rules, which refuse in
both directions, so when the snapshot format moves the two repositories
must speak the same snapshot format: the consumer's hejbro and the
hejbro that generated the migration have to agree.

A reader decides on `manifest_format` from the row's own column, before
parsing the payload, so that a payload it cannot understand is never
interpreted.

#### Scenario: A higher manifest format is refused
- **WHEN** the newest manifest row declares a manifest format higher
  than the reader knows
- **THEN** the reader fails with a coded error naming both formats and
  pointing at the tool version, and does not parse the payload

#### Scenario: A lower manifest format is read
- **WHEN** the newest manifest row declares a manifest format lower than
  the reader knows, and an embedded snapshot format the reader accepts
- **THEN** the reader reads it, and the facts that format does not carry
  are absent rather than an error

#### Scenario: An embedded snapshot format the reader refuses names the two repositories
- **WHEN** the newest manifest row carries an embedded snapshot format
  the reader refuses
- **THEN** the failure carries its own code and this reader's remedy —
  match the consumer's hejbro to the one that generated the migration,
  or regenerate the migration with the newer one — and never the
  guidance written for a snapshot file on disk, which the consumer does
  not have

#### Scenario: Format skew is not reported as staleness
- **WHEN** a reader meets a manifest format it does not know
- **THEN** it does not report the module as behind, and does not advise
  re-syncing

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
