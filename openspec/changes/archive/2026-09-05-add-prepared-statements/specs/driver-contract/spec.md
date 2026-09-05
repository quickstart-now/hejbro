## MODIFIED Requirements

### Requirement: Drivers declare their capabilities
A driver SHALL declare which execution capabilities it supports —
interactive transactions, session state and prepared statements, the
complete set — as inspectable data on the driver value. The query layer
SHALL consult these declarations instead of probing behavior at runtime.

#### Scenario: Capabilities are inspectable
- **WHEN** a driver value is examined before any connection is made
- **THEN** its declared capability set is readable and matches what the
  driver actually supports

### Requirement: The capability set is exhaustive and statically checked
The driver capability set SHALL be a fixed, enumerated set of named
capabilities — exactly three: interactive transactions, session state
and prepared statements — never an open-ended list, and never a bare
index signature. Extending the set is a spec change to this requirement,
not a driver's own addition. A driver value's capability declaration
SHALL name every capability in the set; omitting one, or naming one
outside the set, SHALL fail to type-check rather than silently default.
A mandatory prerequisite every driver must supply just to be a driver at
all (parameterized statement execution) SHALL NOT be represented as a
capability — it lives on the driver's own required surface,
unconditionally, never as a value that could read `false`.

`prepared-statements` differs from the other two in one respect: no
query-layer operation requires it. It states what the driver does with
a built statement, and the query layer never consults it — so the
"declared `false` fails closed" scenario below has no operation to
exercise it with, by design, and a driver declaring it `false` simply
sends every statement unnamed.

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

### Requirement: Vanilla Postgres driver
The `@hejbro/pg` package SHALL provide a driver for standard TCP
Postgres connections that declares interactive transactions and session
state, wrapping an existing client library rather than implementing a
wire protocol. Both of those declarations SHALL be `true` — a single
TCP connection to Postgres inherently supports `BEGIN`/`COMMIT` across
round trips and preserves `SET`-style session state across sequential
statements on the same connection. The driver's prepared-statements
declaration SHALL be the caller's, stated at construction through an
options argument accepted by both constructor forms; when the caller
states nothing it SHALL be `false`, so an existing caller's driver
declares and sends exactly what it did before the option existed.

#### Scenario: Vanilla driver executes over TCP
- **WHEN** a db handle is created with the `@hejbro/pg` driver against a
  reachable Postgres and a compiled statement is executed
- **THEN** the statement runs over a TCP connection and transactions are
  available

#### Scenario: Vanilla driver declares both capabilities true
- **WHEN** `@hejbro/pg`'s driver's capability declaration is examined
- **THEN** both `interactive-transactions` and `session-state` read
  `true`

#### Scenario: Vanilla driver's prepared-statements declaration is the caller's
- **WHEN** `@hejbro/pg`'s driver is built from a pool or from a
  connection string, with the option stating prepared statements, and
  again with the option absent
- **THEN** the first declares `prepared-statements` `true` and the
  second `false`, and both declarations are readable before any
  connection is made

### Requirement: A driver's capability set follows its connection path
A provider whose client library offers more than one connection path
**as distinguishable client values** SHALL declare the capability set of
the path a given driver value was built for, fixed at construction from
the client it was handed — never discovered by probing a connection, and
never a single set that averages the paths. **Where the client value
distinguishes the path,** choosing the path SHALL be the caller's
existing decision (which client they constructed), not a second decision
the driver asks them to repeat. On the session-oriented path the
prepared-statements declaration SHALL be the caller's, stated through an
options argument the session-path constructor accepts and the one-shot
constructor does not offer; unstated, it is `false`.

#### Scenario: A session-path driver declares full capabilities
- **WHEN** a driver is built from the provider's session-oriented client
  (one that keeps a connection open across statements)
- **THEN** it declares both interactive transactions and session state as
  supported, and prepared statements as the caller stated — `false`
  when nothing was stated

#### Scenario: A one-shot-path driver declares its limits
- **WHEN** a driver is built from the provider's one-shot client (one
  that carries no session between statements)
- **THEN** it declares interactive transactions, session state and
  prepared statements as `false`, and every declaration is readable
  before any connection is made

#### Scenario: The path is fixed by the client, not by a runtime probe
- **WHEN** a driver value is constructed
- **THEN** its capability set is already final, and no statement, ping,
  or connection attempt was made to determine it

## ADDED Requirements

### Requirement: A driver that declares prepared statements names its built statements
A driver that declares `prepared-statements` `true` SHALL send every
built statement — one whose kind is `select`, `insert`, `update`,
`delete` or `setOp` — as a named statement, so that a connection parses
and plans each distinct text once and later executions of the same text
on that connection bind to the prepared statement. The name SHALL be
derived from the statement text alone: the same text yields the same
name on every connection and in every process, two different texts do
not share a name — the name is a 128-bit digest of the text, so a
collision is not a practical possibility — and the name fits the
server's identifier length. A
statement of the `sql` kind SHALL always be sent unnamed, whatever the
declaration: the driver parses no SQL, and a text that carries more than
one command cannot be prepared, so the escape hatch, the session pins,
a migration body and a declared-function call (`db.fn`, which compiles
as the `sql` kind) are never named. Whether a statement is named SHALL
depend on the declaration and the statement's kind only — never on the
text, the parameters, or anything observed at run time. A driver that
declares `false` SHALL send every statement unnamed, exactly as it did
before the declaration existed. Once prepared, a statement stays
prepared on its connection for that connection's life; the driver
evicts nothing, and the server's own plan-cache behaviour for prepared
statements applies.

#### Scenario: Built statements are named under the declaration
- **WHEN** a driver declaring prepared statements executes one statement
  of each built kind — `select`, `insert`, `update`, `delete`, `setOp` —
  through its own execution member and inside a transaction it holds
- **THEN** each reaches the client library as a named statement whose
  name is derived from the statement text, and the rows come back
  unchanged

#### Scenario: The name is a function of the text
- **WHEN** the same text is executed twice on one connection, on two
  connections, and in two processes, and a text differing in one
  character is executed beside it
- **THEN** every execution of the same text carries the same name, the
  differing text carries a different name, and every name is within 63
  bytes

#### Scenario: The escape hatch is never named
- **WHEN** a driver declaring prepared statements executes a `sql`-kind
  statement — with parameters, without parameters, and one carrying two
  commands
- **THEN** each is sent unnamed and runs, including the two-command text

#### Scenario: A driver declaring false sends nothing named
- **WHEN** a driver built without the option executes a statement of
  every kind
- **THEN** no statement reaches the client library with a name, and what
  is sent is byte-for-byte what the driver sent before the option existed

#### Scenario: A prepared statement is reused on its connection
- **WHEN** a driver declaring prepared statements executes the same
  built statement twice on one connection against a reachable Postgres
- **THEN** the server's own catalog of prepared statements for that
  connection holds one entry for that text after both executions

### Requirement: A path without session state refuses a base driver that prepares
A driver built for a path that keeps no session between transactions or
executions cannot carry a prepared statement from one execution to the
next: a name prepared on one backend may be bound on another, where it
does not exist, and the failure surfaces only on a later execution, as
the server's own error. Such a driver SHALL therefore declare
`prepared-statements` `false`, and where it decorates a caller-built
base driver it SHALL refuse a base that declares `prepared-statements`
`true` when the decorated driver is constructed — with a coded error
that names the path, states that the base prepares, and ends with a
`Next:` line naming both ways out: build the base without prepared
statements, or use the session-keeping path. The check runs once, at
construction, opens no connection and sends nothing. A base declaring
`false` is decorated as before, and a session-keeping path passes the
base's declaration through unchanged.

#### Scenario: The pooled-transaction path refuses a preparing base
- **WHEN** the Supabase driver is built for the endpoint that keeps no
  session between transactions over a base driver declaring prepared
  statements
- **THEN** construction fails with `prepared-statements-without-session`,
  the message names the endpoint and ends with a `Next:` line naming
  both remedies, no driver value is produced and no connection is opened

#### Scenario: The pooled-transaction path declares false over a non-preparing base
- **WHEN** the Supabase driver is built for the same endpoint over a
  base declaring `prepared-statements` `false`
- **THEN** the decorated driver declares `prepared-statements` `false`
  and behaves as it did before the declaration existed

#### Scenario: The session endpoint passes the declaration through
- **WHEN** the Supabase driver is built for the session endpoint, or with
  no endpoint stated, over a base declaring prepared statements
- **THEN** the decorated driver declares `prepared-statements` `true` and
  its built statements reach the base named
