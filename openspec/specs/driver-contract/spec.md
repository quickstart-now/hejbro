# driver-contract Specification

## Purpose

Defines the capability-declaring driver interface through which the
query layer talks to a database, so execution features degrade with an
explicit error — never silently — on drivers that cannot support them.

## Requirements

### Requirement: Drivers declare their capabilities
A driver SHALL declare which execution capabilities it supports —
interactive transactions, session state, prepared statements and
batched transactions, the complete set — as inspectable data on the driver value. The query layer
SHALL consult these declarations instead of probing behavior at runtime.

#### Scenario: Capabilities are inspectable
- **WHEN** a driver value is examined before any connection is made
- **THEN** its declared capability set is readable and matches what the
  driver actually supports

### Requirement: The capability set is exhaustive and statically checked
The driver capability set SHALL be a fixed, enumerated set of named
capabilities — exactly four: interactive transactions, session state,
prepared statements and batched transactions — never an open-ended list, and never a bare
index signature. Extending the set is a spec change to this requirement,
not a driver's own addition. A driver value's capability declaration
SHALL name every capability in the set; omitting one, or naming one
outside the set, SHALL fail to type-check rather than silently default.
A mandatory prerequisite every driver must supply just to be a driver at
all (parameterized statement execution) SHALL NOT be represented as a
capability — it lives on the driver's own required surface,
unconditionally, never as a value that could read `false`.

`prepared-statements` differs from the other three in one respect: no
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

### Requirement: The contract carries a session-setup hook
The driver contract SHALL include a session-setup hook, invoked once
per newly acquired connection before that connection is handed to any
caller-visible operation. The hook's own presence is part of the
contract every driver implements; what a driver does inside it —
including pinning session-level output formatting (`IntervalStyle`) so
`interval` values parse deterministically regardless of the connecting
client's own default configuration — is that driver's responsibility,
not the query layer's.

#### Scenario: The session-setup hook is a mandatory driver field
- **WHEN** a driver value is constructed without its session-setup hook
- **THEN** the program fails to type-check

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

### Requirement: Vanilla driver row arrival shapes
For an `interval` column — single or array — `@hejbro/pg`'s per-query
type override SHALL deliver Postgres's raw text for that value to the
query layer's own conversion, never the underlying client library's own
pre-parsed interval object(s) — that object has no lossless way back to
text (its default string conversion discards all structure, and its own
text-rendering method reorders and reformats fields rather than
reproducing the original). The override SHALL intercept both the
scalar `interval` oid and the `interval` array oid; an interval array
therefore arrives as Postgres's raw array text. The override SHALL
additionally intercept the `numeric` array oid, delivering Postgres's
raw array text for it too: the client library's own default array
parser for that oid returns already-numeric-parsed JS numbers per
element, silently destroying the scale and precision a
`'string'`/`'bigint'`-mode `numeric` column's declared conversion
needs — unlike scalar `numeric`, which the client library already
leaves as raw text, and unlike `bigint` arrays, whose own default array
parser already returns text elements and therefore need no override.
Every other declared column type — every array oid other than
`interval`'s and `numeric`'s included — SHALL arrive in whatever shape
the underlying client library's own defaults produce, `format` argument
included; the override delegates to that default parser unchanged.

#### Scenario: A single interval column arrives as raw Postgres text
- **WHEN** a table declares a non-array `interval` column and a row
  is read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw interval text, not a pre-parsed object

#### Scenario: An interval array column arrives as raw array text
- **WHEN** a table declares an `interval` array column and a row is
  read through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of pre-parsed objects

#### Scenario: A numeric array column arrives as raw array text
- **WHEN** a table declares a `numeric` array column and a row is read
  through the driver
- **THEN** the value handed to the query layer's conversion is
  Postgres's raw array text (element parsing is the query layer's
  job), never an array of already-parsed JS numbers — scale and
  precision (e.g. trailing zeros, or digits beyond
  `Number.MAX_SAFE_INTEGER`'s own limit) survive intact

#### Scenario: bigint, numeric, and timestamptz are read back in their declared shapes through a real db() handle
- **WHEN** a table declares a `bigint` column (default mode), a
  `numeric` column (`'string'` mode), and a `timestamptz` column, a row
  containing them exists in a real Postgres, and that row is read back
  through `@hejbro/pg` and a real `db()` handle
- **THEN** the `bigint` column reads back as a JS `bigint` exact beyond
  `Number.MAX_SAFE_INTEGER`, the `numeric` column reads back as the
  exact decimal text stored, and the `timestamptz` column reads back as
  a `Date` instance at the stored instant

#### Scenario: Other oids keep the client library's defaults
- **WHEN** a row carries columns of types other than `interval` or
  `numeric` (arrays included — `bigint` arrays included)
- **THEN** each value arrives in the underlying client library's own
  default shape for that oid, `format` argument respected — the
  override intercepts nothing else

### Requirement: Vanilla driver's session-setup hook pins IntervalStyle
`@hejbro/pg`'s driver's session-setup hook SHALL send `set intervalstyle
to 'postgres'` on the session it is given.

#### Scenario: The hook sends the pin
- **WHEN** `@hejbro/pg`'s driver's session-setup hook is invoked,
  directly, with a session
- **THEN** it sends `set intervalstyle to 'postgres'` on that session

### Requirement: Vanilla driver pins IntervalStyle at checkout
`@hejbro/pg`'s driver SHALL pin a physical connection it has not
successfully pinned before, before any caller-supplied statement runs
on it, on both the direct-execute path and the transaction path. It
SHALL NOT repeat the pin on a later checkout of a connection it has
already pinned successfully. A pin attempt that itself fails SHALL NOT
be treated as pinned — the same physical connection SHALL be pinned
again the next time it is checked out. The checkout path SHALL invoke
the session-setup hook through the driver value's own hook member — read
at each checkout, so replacing that member on the driver value takes
effect on every subsequent checkout — never through a captured internal
reference that bypasses the driver value.

What is read late is the member, not the value it is read from: which
driver value the checkout reads is fixed when the driver is built.
Replacing the member on that value is therefore the decoration this
requirement admits. A decorator that instead produces a new driver value
carrying its own hook, leaving the value it decorated unchanged, SHALL
run that hook itself — the base driver's checkout goes on reading the
base's own member.

#### Scenario: The pin precedes the first caller statement, on either path
- **WHEN** `@hejbro/pg`'s driver checks out a physical connection it has
  not seen before, whether for a direct `execute` or for a `transaction`
- **THEN** it sends the IntervalStyle pin before any caller-supplied
  statement on that connection

#### Scenario: A reused connection is not pinned twice
- **WHEN** the same physical connection is checked out again after
  having already been pinned successfully
- **THEN** the pin is not sent again on that checkout

#### Scenario: A failed pin attempt is retried on the next checkout
- **WHEN** a pin attempt on a physical connection itself fails
- **THEN** that connection is not recorded as pinned, and the next
  checkout of the same physical connection attempts the pin again
  before any caller-supplied statement

#### Scenario: A wrapped session-setup hook takes effect at checkout
- **WHEN** the driver value's own session-setup hook member is replaced
  in place — a preset decorator wrapping the original — and a fresh
  physical connection is checked out
- **THEN** the wrapped hook, not the original internal one, runs for
  that checkout's session setup

#### Scenario: A decorator that returns a new driver value runs its own hook
- **WHEN** a decorator returns a new driver value carrying its own
  session-setup hook and leaves the driver value it decorated unchanged
- **THEN** the base driver's checkout runs the base's own member, and
  the new value's hook takes effect only where the decorator itself
  invokes it

### Requirement: Presets ship their own driver
A provider preset package SHALL be able to ship its own driver for its
platform's connection paths, built on the same contract with no special
cases in the query layer. A preset driver SHALL be able to declare a
capability `false` and rely on the query layer's own missing-capability
error, without the preset supplying any substitute behavior for the
capability it lacks.

#### Scenario: Supabase driver plugs in unchanged
- **WHEN** a db handle is created with the Supabase preset's driver
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: Supabase driver plugs in unchanged on its pooled-transaction path
- **WHEN** a db handle is created with the Supabase preset's driver
  built for the endpoint that keeps no session between transactions
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: Neon driver plugs in unchanged on its session path
- **WHEN** a db handle is created with the Neon preset's driver built
  from a session-oriented client
- **THEN** query building, compiling, and execution behave identically
  to the vanilla driver for every capability both drivers declare

#### Scenario: A preset driver's rows arrive in the vanilla shapes
- **WHEN** a preset driver built on a client library with its own type
  parsers — not the vanilla driver's — reads back values whose arrival
  shape the contract fixes
- **THEN** they arrive in the same shapes the vanilla driver produces,
  because the conversion layer above is written against those shapes and
  reads no capability that would tell it otherwise

#### Scenario: A driver's own transaction member refuses when the capability is false
- **WHEN** a driver that declares interactive transactions `false` has
  its transaction member called directly, bypassing the query layer's
  guard
- **THEN** it throws the missing-capability error without sending
  anything to the database, rather than running the callback against a
  session — the driver enforces its own declaration, not only the layer
  above it

#### Scenario: A preset driver's declared-false capability fails closed
- **WHEN** an operation requiring interactive transactions is attempted
  on the Neon preset's one-shot driver
- **THEN** the call fails with the query layer's missing-capability error
  naming the capability and the operation, before anything is sent to the
  database, and the preset contributes no fallback path

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
  prepared statements as `false`, and batched transactions as what its
  one-shot request can actually do — `true` when the client executes a
  statement list atomically in one round trip — and every declaration
  is readable before any connection is made

#### Scenario: The path is fixed by the client, not by a runtime probe
- **WHEN** a driver value is constructed
- **THEN** its capability set is already final, and no statement, ping,
  or connection attempt was made to determine it

### Requirement: A driver without session state guarantees its own statements
A driver that declares session state as `false` SHALL still deliver the
session settings the query layer's value conversion depends on, for the
statements it executes, by applying them as part of each execution rather
than once per connection. Declaring `false` SHALL NOT be read as
permission to let those settings go unapplied: the declaration describes
persistence between executions, not whether the settings hold for the
statement being run. Where such a driver also declares interactive
transactions `true`, the settings SHALL be applied with transaction-local
scope inside the same transaction as the statements they cover, so that
a settings statement can never land in a different transaction — and
therefore on a different backing connection — from the statement it was
meant to cover.

#### Scenario: The settings travel with the statement
- **WHEN** a driver declaring session state `false` executes a statement
- **THEN** what it sends carries those settings together with that
  statement, in that order, so the statement cannot run under a
  connection that never received them

#### Scenario: The declaration stays false
- **WHEN** such a driver's capabilities are examined
- **THEN** session state still reads `false`, because state does not
  persist from one execution to the next

#### Scenario: A driver that keeps transactions but not sessions carries its settings inside one
- **WHEN** a driver declaring interactive transactions `true` and session
  state `false` executes a single statement
- **THEN** the settings are sent after that transaction has opened and
  before the caller's statement, inside it — never before the
  transaction begins, where a transaction-local setting would be
  discarded without applying, and never in a transaction of their own,
  where the endpoint's connection reuse could separate them from the
  statement they cover

#### Scenario: A caller's own transaction carries the settings as its first statements
- **WHEN** such a driver runs a caller-supplied transaction callback
- **THEN** the settings are applied as that transaction's first
  statements, and the driver opens no second transaction around it

#### Scenario: Values arrive in the vanilla shapes on the per-execution path
- **WHEN** such a driver reads back values whose arrival shape the
  session settings determine
- **THEN** they arrive in the same shapes the vanilla driver produces,
  because the settings were applied for that execution — a value's shape
  never depends on how the settings reached the connection

### Requirement: The missing-capability error has one definition
`@hejbro/query` SHALL export a thrower that constructs the driver
contract's own missing-capability failure. A driver package SHALL
construct this failure by calling that export, never by reproducing its
message text.

#### Scenario: A preset driver constructs the shared error
- **WHEN** a driver lacking a capability refuses an operation requiring it
- **THEN** it throws the error built by `@hejbro/query`'s exported
  thrower, carrying the same code, message, and enriched fields as any
  other driver's refusal for the same capability and operation

#### Scenario: The message text has no second copy
- **WHEN** any driver package's source is inspected
- **THEN** the missing-capability message text appears only inside
  `@hejbro/query`, and every other driver's refusal is produced by
  calling the export, not by restating the text

### Requirement: Every declared tier's obligation is machine-verified in this repository
A driver shipped from this repository SHALL be checked, at test time,
against the obligation its declared `session-state` tier carries: a
`false` declaration is checked for carrying its settings with every
execution, in that order; a `true` declaration is checked for delivering
them through its session-setup hook. This check observes order, not
content: it reads no driver's own settings text, so it cannot tell a
genuinely unrelated statement that merely precedes the caller's own from
the settings themselves — it checks only that some statement precedes
the caller's own for a `false` declaration, in the position the settings
would occupy if present, and asserts nothing about what follows the
caller's own statement. This is a deliberate limitation of what this
verification observes, not an oversight it is expected to close.

Where a driver declares session state `false` and interactive
transactions `true`, the check SHALL additionally observe the
transaction the settings and the caller's statement travel in: the
transaction opens first, some statement follows it, the caller's own
statement follows that, and no transaction ends between them. The
observation for such a driver SHALL be taken where the driver's own
transaction control is visible — the statements it emits on its
connection — and an observation that cannot show transaction control
SHALL be refused rather than passed, because it cannot tell settings
sent before the transaction opened, where a transaction-local setting is
discarded without applying, from settings sent inside it. Recognizing
where a transaction opens and ends reads SQL's own transaction-control
statements only; the check still reads no driver's own settings text. A
statement is recognized by the transaction-control keyword it leads
with, not by its exact text, so the ordinary spellings of opening and
ending a transaction are all seen. A statement is classified by its
leading word: the text is trimmed and lower-cased, and the leading word
is the first run of characters that are neither whitespace nor `;`, so
a semicolon glued to the word, and any semicolons around it, never
become part of it. Where a control word is read together with the words
after it (`start transaction`; `rollback`, which rolls back to a
savepoint — and so stays ordinary — when `to` follows it directly or
after one optional `work` or `transaction`, and ends the transaction
otherwise), each following word counts only when whitespace alone
separates it from the one before; a `;` between them ends the leading
statement, and nothing past it is read. A string is never split on an interior `;`
into several statements: a string carrying several is classified by its
first alone, and what a later statement in it does is not seen. Text
that leads with a comment leads with the comment's own characters and
is classified as an ordinary statement; the check reads no SQL lexical
structure beyond the leading word. A statement that only manipulates a
savepoint — establishing one, releasing one, or rolling back to one —
neither opens nor ends a transaction, and counts as an ordinary
statement here. The refusal above reads which record the caller handed
over, not the statements inside it: a record taken where transaction
control is visible but carrying none is judged against the obligation
and fails it, rather than being refused as the wrong record.

The check SHALL read which tier applies from the driver's own
capabilities declaration, never from a choice the caller makes
independently of it, and SHALL NOT use observed
behavior to infer, normalize, or correct the declaration itself — reading
the declaration to select an obligation is required; changing it from
what is observed is forbidden. This verification is repo-internal; it is
not part of any package's published surface, and a package that consumes
it internally SHALL wire the two resolution paths that need it
separately — a test runner's own module aliasing for the specifier at
test time, and the consuming package's own type-checker path mapping to
the same single file for type-checking, since a type-checker follows a
package's published `exports` map rather than a test runner's aliasing
and would not otherwise see an internal-only module. Exposing this
verification as a public export is additive and is deferred until a
driver author outside this repository needs it — deferring does not
modify this requirement.

#### Scenario: A driver that fails its declared tier's obligation is caught
- **WHEN** a driver's actual behavior does not carry out the obligation
  its own capabilities declare
- **THEN** a test run against it fails, naming which tier's obligation
  was not observed

#### Scenario: A driver checked against the wrong tier is refused, not silently passed
- **WHEN** a driver is checked with the observation shape for a tier
  other than the one its own capabilities declare
- **THEN** the check itself refuses, rather than silently applying the
  wrong obligation or passing without having checked anything

#### Scenario: A compliant driver's declaration is left unchanged
- **WHEN** a driver's behavior is checked against its declared tier and
  found compliant
- **THEN** its capabilities value reads exactly as it did before the
  check ran

#### Scenario: Settings sent before the transaction opens are caught
- **WHEN** a driver declaring session state `false` and interactive
  transactions `true` sends its settings before the transaction that
  carries the caller's statement opens
- **THEN** the check fails, naming the tier's obligation, even though a
  statement did precede the caller's own

#### Scenario: An observation that cannot show transaction control is refused
- **WHEN** such a driver is checked against an observation that records
  only the statements crossing the driver's own execute contract, where
  a transaction's opening never appears
- **THEN** the check refuses on which record it was handed rather than
  on what that record contains, instead of applying the obligation to
  statements that cannot show where the transaction begins

#### Scenario: A semicolon glued to the leading word does not hide it
- **WHEN** an envelope carries, in the position of a transaction
  boundary, any of `commit;`, `commit; ;`, `COMMIT;;`, `;commit`,
  `rollback; to savepoint x`, `  BEGIN ;`, `begin; set local x`
- **THEN** each is classified by its leading word — the `commit` and
  `rollback` forms end the transaction, so a caller statement after one
  of them is reported as sent outside an open transaction, and the
  `begin` forms open one, so a conforming wire that opens with either is
  not refused

#### Scenario: Nothing past the leading statement is read
- **WHEN** an envelope carries, between the transaction's opening and
  the caller's own statement, any of `start; transaction`,
  `savepoint x;`, `select 'begin; commit'`, `select ';'`
- **THEN** each counts as an ordinary statement — `start; transaction`
  opens nothing because its second word is past a `;`, and a semicolon
  or a control word inside a string literal is never reached — so the
  envelope conforms with that statement standing in for the settings

#### Scenario: A savepoint rollback keeps its optional words
- **WHEN** an envelope carries, between the transaction's opening and
  the caller's own statement, any of `rollback transaction to savepoint
  x`, `rollback work to savepoint x`, `ROLLBACK TRANSACTION TO SAVEPOINT
  s`
- **THEN** each counts as an ordinary statement, exactly as `rollback to
  savepoint x` does, so the envelope conforms — while `rollback work`
  and `rollback transaction` on their own still end the transaction

#### Scenario: A comment-led statement is ordinary
- **WHEN** an envelope carries `-- opens\nbegin` where the opening would
  be, or `/* trace */ commit` between the opening and the caller
- **THEN** each is classified as an ordinary statement — the first
  envelope has no opening and is reported as such, the second conforms —
  because the leading word is the comment's own text, and that is the
  limit of what this check reads

### Requirement: A provider whose paths are indistinguishable in the client value takes the path as a declaration
Where a provider's connection paths differ in capability but are carried
by the same client type — one client class pointed at a different
endpoint — the driver SHALL take the path as an explicit statement made
by the caller at construction. It SHALL NOT derive the path from the
client value's own configuration: not from a connection string, a host,
a port, or any other option the client carries. The declared path SHALL
fix the capability set at construction, before any connection exists,
and SHALL NOT be a single set that averages the endpoints. A driver
SHALL NOT send any statement, open any connection, or otherwise consult
the server to confirm or correct the declaration. Where no path is
declared, the driver SHALL keep the capability set it declared before
the option existed, so an existing caller's declaration is never changed
by the arrival of a second path.

A declared value the driver does not recognize SHALL be rejected when
the driver value is constructed, with an explicit coded error naming the
values that are recognized. It SHALL NOT fall back to any path,
including the default one: a misspelled declaration that silently
selects the session path would restore exactly the intermittent,
error-free, wrong-value-shape failure the declaration exists to remove,
and would do so for the caller who tried hardest to be explicit. The
check runs once, where the driver is constructed, and never on the
execution path.

#### Scenario: A declared path fixes the capability set
- **WHEN** a driver is built for a provider whose endpoints share one
  client type, with the path stated at construction
- **THEN** its capability set follows the stated path and is readable
  before any connection is made

#### Scenario: The declaration is not derived from the client's configuration
- **WHEN** the client value carries a connection string, host, or port
  that would reveal which endpoint it addresses
- **THEN** the driver reads none of them, and the stated path alone
  decides the capability set

#### Scenario: A declared path is never confirmed against the server
- **WHEN** a driver value built from a declared path executes a
  statement
- **THEN** nothing was sent to the server to confirm or correct the
  declaration, and the declaration is not revised by anything observed
  at run time

#### Scenario: An undeclared path keeps the previous declaration
- **WHEN** a driver is built without stating a path
- **THEN** it declares exactly the capability set it declared before the
  path could be stated at all

#### Scenario: An unrecognized declared path is refused at construction
- **WHEN** a driver is built with a path value the driver does not
  recognize — a caller with no type checking, or a misspelling
- **THEN** construction fails with a coded error listing the recognized
  values, no driver value is produced, and no path is selected on the
  caller's behalf

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

### Requirement: A driver declares whether its platform has roles
A driver SHALL be able to declare that its platform has no roles a
context could name. The declaration SHALL be data on the driver value,
fixed before any connection exists, never discovered by querying the
server, and its absence SHALL mean "this platform has roles" — so no
existing driver changes meaning by staying silent.

The declaration SHALL govern which contexts the query layer admits: on a
driver that declares its platform role-less, a context naming no role is
admitted; on any other driver, it is refused. A driver SHALL NOT be able
to use this declaration to skip validation of a role that *is* named.

#### Scenario: The declaration is readable before any connection
- **WHEN** a driver value declaring a role-less platform is examined
- **THEN** the declaration is present as data, and no connection,
  statement, or probe was made to produce it

#### Scenario: Silence means the platform has roles
- **WHEN** a driver that makes no such declaration is handed a context
  naming no role
- **THEN** the execution is refused, exactly as if the driver had declared
  its platform has roles

#### Scenario: A named role is still validated on a role-less platform
- **WHEN** a context naming a role is used on a driver declaring a
  role-less platform
- **THEN** the role is validated against the same four-source whitelist,
  and the declaration grants no exemption from it

### Requirement: A driver can declare a context mandatory
A driver SHALL be able to declare that no statement may run against it
without an execution context, so that the query layer refuses an
uncontexted execution before anything reaches the database. The
declaration SHALL be data on the driver value, fixed before any
connection exists, and its absence SHALL leave existing behavior exactly
as it is.

The declaration SHALL NOT be represented as a capability, SHALL NOT be
inferred from the platform or from an observed error, and SHALL NOT be
satisfied by anything the driver does on its own — the refusal belongs to
the query layer, which is the only layer that can refuse before a
statement exists.

#### Scenario: The declaration is inspectable data
- **WHEN** a driver value declaring a mandatory context is examined
  before any connection is made
- **THEN** the declaration is readable, and nothing was sent to the
  server to establish it

#### Scenario: A driver cannot satisfy it by itself
- **WHEN** such a driver receives a statement through its own execute
  member, bypassing the query layer
- **THEN** the driver's own behavior is unchanged by the declaration —
  the declaration governs what the query layer refuses to send, not what
  the driver does with what it is given

### Requirement: Contributing a context rendering does not widen who may run one
An execution under a context SHALL continue to require the
interactive-transaction capability, asserted before any resolver is
consulted and before any statement is sent. A driver that contributes a
context rendering but does not declare interactive transactions SHALL
still be refused a context, with the same missing-capability error, and
its contribution SHALL never be applied.

#### Scenario: A contributing driver without transactions is still refused
- **WHEN** an execution under a context is attempted on a driver that
  contributes a context rendering and declares interactive transactions
  `false`
- **THEN** the execution fails with the missing-capability error naming
  the capability and the operation, the contribution is never invoked,
  and nothing reaches the database

#### Scenario: The capability is asserted before the resolver
- **WHEN** an execution is attempted on a provider handle whose driver
  lacks interactive transactions and contributes a context rendering
- **THEN** the failure names the missing capability, and neither the
  resolver nor the contribution was called

#### Scenario: A preset's one-shot path is unchanged by the contribution point
- **WHEN** `db.as(context)` is used on the Neon preset's one-shot (HTTP)
  driver, after a context-rendering contribution point exists on the
  contract
- **THEN** it fails with exactly the missing-capability error it failed
  with before that point existed, nothing reaches the database, and no
  contributed or default rendering is applied — the set of drivers that
  may run a context is the same set as before this change

### Requirement: The Nile preset ships a decorator driver
The Nile preset SHALL ship its driver as a decorator over a driver the
caller already built, rather than as a driver that wraps a client library
of its own. The platform speaks plain Postgres on one connection path,
so there is no second path to model and no wire to reimplement. The
package SHALL declare no runtime dependency on any Nile package.

The decorator SHALL add exactly what the platform needs — a context
rendering and the two platform declarations — and SHALL pass everything
else through unchanged:

- `transaction` SHALL be the base driver's, and the decorator SHALL NOT
  send any statement of its own before the caller's callback runs;
  anything it needs inside the transaction rides in its rendering.
- `capabilities` SHALL be the base driver's, unchanged. A base that does
  not declare interactive transactions is therefore refused a context by
  the query layer's existing capability gate, and the decorator SHALL NOT
  make it appear otherwise.

#### Scenario: The decorator forwards the base's transaction untouched
- **WHEN** an execution opens a transaction through the decorated driver
- **THEN** the base driver's own transaction is what runs, and no
  statement issued by the decorator precedes the caller's callback

#### Scenario: The decorator forwards the base's capabilities
- **WHEN** a decorated driver's capability declaration is examined
- **THEN** it reads exactly as the base driver's does, with no capability
  added, removed, or rewritten by the decoration

#### Scenario: A base without interactive transactions is still refused a context
- **WHEN** a context is used on a decorated driver whose base declares
  interactive transactions `false`
- **THEN** the execution fails with the missing-capability error, and the
  preset's rendering is never invoked

#### Scenario: The package carries no provider client dependency
- **WHEN** the published package's manifest is examined
- **THEN** it declares no dependency — runtime, peer, or optional — on a
  Nile client package

#### Scenario: The decorator, the builder, and the preset are importable from the package entry
- **WHEN** a consumer imports `nileDriver`, `asTenant`, and the preset
  bundle from `@hejbro/nile`'s public entry point
- **THEN** each resolves to the value the package's own tests exercise,
  and no deep or internal module path is required

### Requirement: The Nile decorator states which base drivers it supports
A base driver whose own session statements are sent **inside the
transaction it opens** would place those statements ahead of the tenant
setting, which this platform refuses (measured on its test container;
its published limitations table does not state it). The preset SHALL
therefore support
base drivers that pin their session at connection checkout — outside any
transaction — and its documentation SHALL state the unsupported shape so
a reader meets it before a database does.

#### Scenario: A base that pins at checkout is supported
- **WHEN** the decorator is built over a base driver that applies its
  session settings at connection checkout
- **THEN** an execution under a tenant context sends the tenant setting as
  the first statement inside the transaction, and the base's own settings
  are not among the statements that precede it there

#### Scenario: The unsupported shape is documented where users read
- **WHEN** the preset's user documentation is examined
- **THEN** it states that a base driver applying session statements
  inside its own transaction is not supported by this decorator, and why

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

### Requirement: A driver executes a pre-composed batch atomically
A driver declaring `batched-transactions` SHALL execute a pre-composed
list of compiled statements through its `batch` member as one
transaction, in one round trip where the path allows it: the members
run in order, the result is one row list per member in that order, a
failing member fails the whole call, and nothing of a failed batch is
visible afterwards. A driver declaring session state `false` SHALL
carry its own session settings as the batch's first members. An empty
member list SHALL send nothing — not even those session settings — and
yield an empty list: nothing was asked for, so nothing reaches the
database. The
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
