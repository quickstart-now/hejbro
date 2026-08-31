# driver-contract (delta)

## MODIFIED Requirements

### Requirement: Missing capability is an explicit error
When an operation requires a capability the active driver does not
declare, the query layer SHALL fail with an explicit error that names
the missing capability and the operation, before sending anything to
the database. Silent fallback to different semantics is forbidden.

Where the query layer raises this failure for an execution a caller made
through a db handle, the operation it names SHALL be the surface the
caller invoked, spelled as the caller spells it — never the name of a
construction option, and never one name standing in for several
surfaces; the declared-function API counts as one surface with one
token. The transaction API is excepted here as it is in the
context-refusal requirement, and for the same reason: its token stays
`transaction`, the spelling a driver's own thrower also uses, because
this requirement's uniformity rule binds the two to match. Where a
driver raises the failure for its own member, the
operation SHALL be that member's name. The obligation covers the tokens
this repository's own layers produce: the thrower is a public export, so
a driver package outside this repository passes a token of its own
choosing and the contract cannot mechanize that.

#### Scenario: Transaction on a non-transactional driver
- **WHEN** a transaction (or any feature built on transactions) is
  attempted on a driver that does not declare interactive transactions
- **THEN** the call fails with an error identifying the missing
  capability, and no statement reaches the database

#### Scenario: The refusal names the surface the caller invoked
- **WHEN** a statement execution, a chain member, and a declared-function
  call are each refused for a missing capability on a handle whose
  driver cannot hold a transaction open
- **THEN** each error names the surface its own caller invoked, and none
  of them names an option given at the handle's construction

### Requirement: A driver may contribute how a context becomes statements
The driver contract SHALL carry an optional context-rendering
contribution: a driver MAY turn an execution context into an ordered list
of compiled statements. The contribution SHALL be a pure mapping from the
context value to statements — it SHALL NOT send anything, open a
connection, hold a session, or consult the server — and the query layer
SHALL be the one that sends the returned statements, first among the
statements it sends inside the transaction it opens for that execution,
ahead of the caller's own, in the order given.

The contribution SHALL NOT be represented as a driver capability: the
capability set stays exactly the two named capabilities, and this is a
declaration about how a platform takes a context, in the same spirit as
the contributed roles a driver already declares. A driver that
contributes nothing SHALL be applied the query layer's default rendering,
whose statements SHALL be unchanged from those the layer sent before any
contribution point existed.

The default rendering SHALL be reachable by a driver package, so a driver
whose platform needs the ordinary statements plus its own can compose
them rather than restate them.

The statements the query layer sends first are first **among its own**:
a driver may already send session statements of its own inside the
transaction it opens, before the query layer sends anything (a
transaction-mode pooler pinning output formats is the shipped example,
and its pins do precede the context statements today). Where a platform
requires the context to precede every other statement in the
transaction, its driver SHALL carry those session statements in its own
rendering — after the context statements it renders and before the
caller's own — rather than in the transaction setup that runs earlier.
The query layer SHALL preserve the order the rendering returns, which is
what makes that placement sufficient.

A rendering that returns no statement for a context is not an
application of that context: nothing about the execution has been
narrowed by it. Where the same driver declares a context mandatory, the
query layer SHALL refuse that execution rather than run it, as the
mandatory-context requirement states. Where the driver makes no such
declaration, the empty result stays what it is and nothing is sent,
because an execution on that driver was already permitted to carry no
context at all. The query layer SHALL draw either conclusion from the
number of statements returned alone, having inspected none of them.

#### Scenario: A driver that must run the context first carries its own statements in the rendering
- **WHEN** a driver whose platform requires the context to come first
  renders a context, and an execution runs under it
- **THEN** its rendering's own session statements arrive after the
  context statements and before the caller's statement, in the order the
  rendering returned them, and the driver's transaction setup sends
  nothing ahead of them

#### Scenario: The contribution is a pure mapping
- **WHEN** a contributing driver's rendering is called with a context, in
  a test with no database
- **THEN** it returns the statements it would apply, and nothing is sent,
  connected, or consulted

#### Scenario: The query layer sends what the driver returned
- **WHEN** an execution runs under a context on a contributing driver
- **THEN** the statements the driver returned are the first statements
  the query layer itself sends inside that execution's transaction,
  ahead of the caller's own, in the driver's own order, sent through the
  query layer's own execution path

#### Scenario: Contributing nothing keeps the existing statements
- **WHEN** an execution runs under a context on a driver that contributes
  no rendering — the vanilla driver and both existing presets included
- **THEN** the statements sent are exactly the ones sent before this
  contribution point existed

#### Scenario: The contribution is not a capability
- **WHEN** a driver value's declared capability set is examined
- **THEN** it still names exactly the two fixed capabilities, and the
  context-rendering contribution is not among them

#### Scenario: The default rendering is importable from the package entry
- **WHEN** a driver package imports the default rendering from
  `@hejbro/query`'s public entry point
- **THEN** the import resolves to the rendering the query layer itself
  applies, and no deep or internal module path is required

#### Scenario: An empty rendering is not an application of the context
- **WHEN** a rendering returns no statement for a context, on a driver
  that declares a context mandatory
- **THEN** the execution is refused rather than run, and that conclusion
  is reached from the number of statements returned, with none of them
  inspected or rewritten
