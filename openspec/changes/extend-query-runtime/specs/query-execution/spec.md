# query-execution (delta)

## ADDED Requirements

### Requirement: A handle retains the declarations it was built from
A db handle SHALL retain every declaration of the schema module it was
constructed from, not only the tables and functions it classifies for
execution. The retained declarations SHALL be the module's own values,
never a copy or a reserialization, so anything that inspects the handle
inspects exactly what the handle types its queries from.

Retention SHALL NOT change how the handle classifies declarations for
execution: the tables, functions, and declared roles a handle exposes
today SHALL be unchanged by it.

#### Scenario: A declaration that is neither a table nor a function survives
- **WHEN** a schema module exporting an enum, a view, a grant, and a
  table is passed to the handle factory
- **THEN** all four declarations are reachable from the handle, not only
  the table

#### Scenario: Retained declarations are the module's own values
- **WHEN** a retained declaration is compared with the schema module's
  own export by identity
- **THEN** they are the same object, and the handle's tables, functions,
  and declared roles are exactly what they were before retention

### Requirement: A connected database can be asserted to match a handle's declarations
A caller SHALL be able to assert, explicitly and on demand, that the
database a handle is connected to matches the declarations that handle
was built from. The assertion SHALL be opt-in: constructing a handle
SHALL NOT connect, SHALL NOT read the catalog, and SHALL NOT send any
statement, so the cost of the assertion is paid only where a caller
writes it.

The assertion SHALL complete before any of the caller's own statements
run, and on divergence SHALL fail rather than return a report: a caller
that awaits it and proceeds has been told the database matched.

#### Scenario: A matching database passes
- **WHEN** the assertion runs against a database that contains every
  declared object as declared
- **THEN** it completes without throwing

#### Scenario: A divergent database fails, naming the objects
- **WHEN** a declared object is missing from the database, or differs
  from its declaration
- **THEN** the assertion throws, and each diverging object is named
  individually — findings per object, never a diff of two texts

#### Scenario: Constructing a handle never connects
- **WHEN** a handle is constructed over a driver that records every
  statement it is asked to execute
- **THEN** no statement has been sent by the time construction returns

### Requirement: The assertion states the boundary of what it compared
The assertion SHALL compare declarations through an object-kind registry
it is given, defaulting to the generic Postgres registry when the caller
supplies none. A declaration that no kind in that registry owns SHALL be
reported by name as not compared — never silently skipped, and never
counted as matching. The boundary SHALL be reported whether or not
anything diverged, so a caller can tell "nothing differed" apart from
"nothing was looked at".

#### Scenario: A declaration outside the registry is named as not compared
- **WHEN** the schema module contains a declaration whose kind the
  supplied registry does not own
- **THEN** the assertion reports that declaration by name as not
  compared, and does not treat it as matching

#### Scenario: A preset declaration is compared once its registry is supplied
- **WHEN** the same schema module is asserted with the registry the
  project's preset contributes
- **THEN** the previously not-compared declaration is compared like any
  other, and no longer appears on the boundary report

#### Scenario: The boundary is reported on the passing path too
- **WHEN** every compared object matches and some declaration was out of
  the registry's reach
- **THEN** the caller is still told what was not compared, rather than
  receiving a bare success

### Requirement: The assertion never reaches the filesystem
The assertion SHALL be usable from a deployed application, not only from
a command line: its module graph SHALL NOT reach the filesystem, the
process environment, or the command-line machinery. Every read it
performs SHALL go through the driver it was handed.

#### Scenario: The assertion's import graph is free of filesystem access
- **WHEN** the assertion module's transitive imports are walked
- **THEN** no filesystem, process, or command-line module appears among
  them
