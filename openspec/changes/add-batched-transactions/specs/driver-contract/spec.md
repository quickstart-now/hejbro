## MODIFIED Requirements

### Requirement: Drivers declare their capabilities
A driver SHALL declare which execution capabilities it supports —
interactive transactions, session state, prepared statements and batched transactions, the complete set — as
inspectable data on the driver value. The query layer SHALL consult
these declarations instead of probing behavior at runtime.

#### Scenario: Capabilities are inspectable
- **WHEN** a driver value is examined before any connection is made
- **THEN** its declared capability set is readable and matches what the
  driver actually supports

### Requirement: The capability set is exhaustive and statically checked
The driver capability set SHALL be a fixed, enumerated set of named
capabilities — exactly four: interactive transactions, session state,
prepared statements and batched transactions — never an open-ended list, and never a bare index signature.
Extending the set is a spec change to this requirement, not a driver's
own addition. A driver value's capability declaration SHALL name every
capability in the set; omitting one, or naming one outside the set,
SHALL fail to type-check rather than silently default. A mandatory
prerequisite every driver must supply just to be a driver at all
(parameterized statement execution) SHALL NOT be represented as a
capability — it lives on the driver's own required surface,
unconditionally, never as a value that could read `false`.

#### Scenario: Omitting a declared capability is a compile error
- **WHEN** a driver's capability declaration omits one of the fixed set's
  keys
- **THEN** the program fails to type-check

#### Scenario: Naming an undeclared capability is a compile error
- **WHEN** a driver's capability declaration includes a key outside the
  fixed set
- **THEN** the program fails to type-check

#### Scenario: A capability explicitly declared false fails closed
- **WHEN** a driver declares a capability as `false` (as opposed to
  omitting it)
- **THEN** an operation requiring that capability fails with the
  missing-capability error exactly as it would for an undeclared driver
  — `false` is never treated as "attempt it anyway"

### Requirement: A driver's capability set follows its connection path
A provider whose client library offers more than one connection path
**as distinguishable client values** SHALL declare the capability set of
the path a given driver value was built for, fixed at construction from
the client it was handed — never discovered by probing a connection, and
never a single set that averages the paths. **Where the client value
distinguishes the path,** choosing the path SHALL be the caller's
existing decision (which client they constructed), not a second decision
the driver asks them to repeat.

#### Scenario: A session-path driver declares full capabilities
- **WHEN** a driver is built from the provider's session-oriented client
  (one that keeps a connection open across statements)
- **THEN** it declares both interactive transactions and session state as
  supported

#### Scenario: A one-shot-path driver declares its limits
- **WHEN** a driver is built from the provider's one-shot client (one
  that carries no session between statements)
- **THEN** it declares interactive transactions and session state as
  `false`, and batched transactions as what its one-shot request can
  actually do — `true` when the client executes a statement list
  atomically in one round trip — and every declaration is readable
  before any connection is made

#### Scenario: The path is fixed by the client, not by a runtime probe
- **WHEN** a driver value is constructed
- **THEN** its capability set is already final, and no statement, ping,
  or connection attempt was made to determine it

## ADDED Requirements

### Requirement: A driver executes a pre-composed batch atomically
A driver declaring `batched-transactions` SHALL execute a pre-composed
list of compiled statements through its `batch` member as one
transaction, in one round trip where the path allows it: the members
run in order, the result is one row list per member in that order, a
failing member fails the whole call, and nothing of a failed batch is
visible afterwards. A driver declaring session state `false` SHALL
carry its own session settings as the batch's first members. The
capability says nothing about sessions or interactivity: no state
survives from one batch to the next, and a member cannot depend on a
prior member's rows. A driver declaring the capability `false` SHALL
still carry the `batch` member and SHALL implement it by raising the
missing-capability error before anything is sent — the same shape its
`transaction` takes on a path without interactive transactions — so the
contract keeps one static shape and the exhaustiveness check keeps one
rule.

#### Scenario: A batch runs in order and returns every member's rows
- **WHEN** a driver declaring batched transactions executes a list of
  three statements
- **THEN** the statements reach the database in that order inside one
  transaction, and the call resolves three row lists in the same order

#### Scenario: A failing member fails the batch
- **WHEN** the second of three members raises
- **THEN** the call rejects with that error, the first member's effect
  is not visible afterwards, and the third member never ran

#### Scenario: A one-shot driver's pins lead the batch
- **WHEN** a driver declaring session state `false` and batched
  transactions `true` executes a batch
- **THEN** its own session settings are the first members of what it
  sends, followed by the caller's members in order

#### Scenario: A driver without the capability refuses before sending
- **WHEN** `batch` is called on a driver declaring batched transactions
  `false`
- **THEN** it raises the missing-capability error naming
  `batched-transactions`, and nothing reaches the database

### Requirement: The prepared-statement name is derived by one exported helper
The name a driver declaring `prepared-statements` gives a built
statement — `hejbro_` followed by 32 hexadecimal characters of the
SHA-256 of the statement text — SHALL be derived by one function
exported from the driver-contract surface, and no shipped driver SHALL
hold a copy of the derivation. The same text yields the same name on
every driver, connection and process because there is one function,
not because two copies happen to agree.

#### Scenario: Both drivers name through the export
- **WHEN** the vanilla and the Neon WebSocket drivers prepare the same
  statement text
- **THEN** both names equal the exported helper's result for that text,
  and neither package defines a derivation of its own

### Requirement: A multi-command text resolves to its last command's rows
When a `sql`-kind text carrying more than one command is executed
through a driver holding a session (the vanilla driver, the Neon
WebSocket driver), `execute` SHALL resolve to the rows of the last
command, as `psql` reports them — never to `undefined`, and never to
the first command's rows. A driver's own session-setup text follows the
same rule. The query layer never composes such a text; the `sql` escape
hatch is its only source.

#### Scenario: Two selects resolve to the second's rows
- **WHEN** `sql\`select 1 as a; select 2 as b\`` is executed on the
  vanilla or the Neon WebSocket driver
- **THEN** the call resolves `[{ b: 2 }]`

#### Scenario: A trailing command without rows resolves to no rows
- **WHEN** a text whose last command returns no rows (a `set`, a DDL)
  follows a select
- **THEN** the call resolves an empty array, not `undefined`
