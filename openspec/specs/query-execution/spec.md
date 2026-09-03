# query-execution Specification

## Purpose

Defines the db handle that executes built statements through a driver
and the transaction API, turning compiled SQL plus parameters into typed
rows with predictable error behavior.

## Requirements

### Requirement: A db handle executes built statements
A db handle SHALL be constructed from schema declarations plus a driver
and SHALL execute built statements, returning rows typed by the
statement's inferred result type. What is sent to the database SHALL be
exactly the statement's pure `compile()` output.

#### Scenario: Executed SQL equals previewed SQL
- **WHEN** a statement is compiled for preview and then executed on a db
  handle
- **THEN** the SQL text and parameters the driver receives are identical
  to the previewed compile output, and the resolved rows carry the
  inferred result type

### Requirement: Nested transactions are rejected, not silently flattened
Calling the transaction API **on the db handle** again from inside an
already-open callback of that same member SHALL fail immediately with an
explicit error, before any further statement is sent; the query layer
SHALL NOT silently flatten such a call into the outer transaction (or
open a second, unrelated one). That call would take a second connection
out of the pool rather than nest, so the error SHALL name the `tx`
handle's own transaction API as the way to nest.

#### Scenario: A nested transaction() call on the db handle fails fast
- **WHEN** the db handle's `transaction()` is called again from inside its
  own already-open callback
- **THEN** the inner call rejects with an explicit error identifying the
  condition and naming `tx.transaction(...)` as the supported way to
  nest, its own callback never runs, and no further statement reaches the
  database

### Requirement: Database errors propagate with context
Execution failures reported by the database SHALL surface to the caller
carrying the driver's underlying error as the cause; the query layer
SHALL NOT swallow, retry, or reinterpret them. The thrown error's
message SHALL lead with the driver's own message — the reason survives
where long text is truncated — followed by the executed statement's
parameterized SQL text (every value already a bind-parameter
placeholder). A cause with no usable message SHALL be named as such in
the message, never interpolated as `undefined` or an object's default
string form.

The query layer itself SHALL NEVER write the statement's parameter
*values* onto the thrown error — not into the message (the SQL stays
parameterized; the params array is never read on this path), not as an
enumerable field, not via the error's string or JSON representation.
Text the database echoes inside its own error message or fields is the
database's report and is carried faithfully, not scrubbed.

#### Scenario: Constraint violation reaches the caller
- **WHEN** an executed insert violates a declared unique constraint
- **THEN** the call rejects with an error whose message leads with the
  driver's own message (the constraint's name included, when the driver
  reports it), exposing the underlying database error as `cause`, and no
  automatic retry occurs

#### Scenario: Parameter values never reach the thrown error
- **WHEN** an executed, parameterized statement fails
- **THEN** the thrown error's message contains the statement's SQL text
  with bind-parameter placeholders, and the value bound to each
  placeholder is nowhere written by the query layer — not in the
  message's SQL text, not as a field, not via the error's string or
  JSON form

#### Scenario: A server-echoed value is carried, not scrubbed
- **WHEN** the driver's own error message or fields quote a value the
  server echoed back
- **THEN** the thrown error's message carries the driver's message
  verbatim — fidelity to the database's report wins over scrubbing text
  this layer did not write

#### Scenario: A non-error cause is named, not interpolated
- **WHEN** the driver rejects with a value that is not an `Error` or has
  no message
- **THEN** the thrown error's message names the absence of a driver
  message and still carries the statement's parameterized SQL text

### Requirement: Statement typing and the chain surface are uniform across every execution surface
The same thenable `select`/`insert`/`update`/`deleteFrom` chain entry
points, built from one shared factory, SHALL exist with identical
members on the unscoped db handle, the `db.as(context)` scoped handle,
and the `tx` a `transaction()` callback receives — and every one of
those surfaces SHALL resolve a statement's inferred result types
identically, `execute` included. Applying a context can never cover
one of these surfaces while missing another, and no surface
under-promises the types the others resolve.

#### Scenario: A scoped chain runs inside its context-applied transaction
- **WHEN** a chain member is awaited on a `db.as(context)` handle
- **THEN** the role/setting statements that context applies and the
  chain's own statement all land on that one transaction, in that order

#### Scenario: A tx chain shares the callback's one open connection
- **WHEN** a chain member is awaited on the `tx` a `transaction()`
  callback received
- **THEN** its statement runs on that same held connection, never a
  fresh one

#### Scenario: tx.execute resolves the same inferred types as every other surface
- **WHEN** `tx.execute(statement)` is called on the same `tx` a chain
  member is also available on
- **THEN** it resolves the statement's inferred result type — the same
  type `db.execute` and the chain member resolve — at both `tx`
  creation sites

### Requirement: Row-conversion internals are not part of the public contract
The primitives that resolve a driver row's per-column conversion plan
(matching a returned column against its declared column state, and
converting one raw row through that plan) are internal to the query
package's own execution pipeline. They SHALL NOT be part of its public
entry surface — exposing them would let a driver or preset couple to
conversion internals that owe no compatibility promise across releases.

#### Scenario: Conversion internals are absent from the public entry surface
- **WHEN** the query package's public entry surface is inspected
- **THEN** it exposes no export for resolving a declared column's
  conversion state, planning a statement's or a result's per-column
  conversion plan, or converting one raw row through such a plan

### Requirement: Nested values are revived to their declared types
Executing a statement with nested reads SHALL deliver every nested
value converted to its column's declared read type, exactly as a
top-level read converts it — `bigint` values past 2^53 arrive intact
as `bigint` (the compiler casts at-risk columns to text inside the
JSON payload; the casts are visible in `compile()`), datetimes arrive
as `Date`, structured values arrive structured. The whole read is one
statement in one round trip — under an RLS execution context it runs
inside that context's single transaction like any other statement,
and no client-side stitching across statements occurs. An empty
collection arrives as `[]`; a missing single row arrives as `null`.

A nested cell SHALL NOT lose that protection by being an aggregate
rather than a plain column: `count()` and a `min`/`max` over an
at-risk column are cast and revived the same way, because JSON has
already lost the precision by the time the value reaches the client
and a wrong value is worse than an unconverted one. `sum`/`avg` are
deliberately outside this: their result type is not the argument's,
so they are neither cast nor converted, and casting them would deliver
text where a number is expected.

The at-risk cast is the compiler's own encoding, and conversion SHALL
undo exactly that: a value arriving through it is revived by the type
of the expression *inside* the cast — whatever that expression is, a
column reference or an aggregate — so a newly castable cell shape does
not also require teaching the reviver a new expression kind. A `::text`
cast a user writes through the `sql` escape hatch SHALL NOT be undone:
an explicit cast is an instruction, and reviving past it would deliver
a `bigint` where its author asked for text.

#### Scenario: Precision survives the JSON round trip
- **WHEN** a child row holds a `bigint` column value of
  `9007199254740993n` (past `Number.MAX_SAFE_INTEGER`) and the parent
  is read with a nested collection
- **THEN** the delivered nested value is exactly `9007199254740993n`,
  and the compiled SQL shows the text cast that preserved it

#### Scenario: An aggregate cell keeps its precision too
- **WHEN** a nested collection projects `count()` or `max()` over a
  `bigint` column whose value is past `Number.MAX_SAFE_INTEGER`
- **THEN** the delivered value is exactly that `bigint`, not a rounded
  number and not the cast's text

#### Scenario: An explicit user cast is left alone
- **WHEN** a nested cell is written as `` sql`${max(posts.views)}::text` ``
- **THEN** the delivered value is the text the cast asked for, not a
  revived `bigint`

#### Scenario: One statement under the RLS context
- **WHEN** `db.as(ctx).select(posts).related({ comments: true })` runs
- **THEN** exactly one statement executes inside the context's
  transaction, and the nested rows obey the same RLS policies the
  context grants

### Requirement: Set-operation results convert per the left branch
Executing a set-operation statement SHALL deliver rows converted
exactly as a select over the LEFT branch would convert them — declared
keys, numeric modes, intervals, arrays, the whole existing conversion
contract — in one statement and one round trip, under an RLS execution
context exactly like any other statement.

#### Scenario: Converted values arrive through a union
- **WHEN** a union over tables declaring a `bigint` and an `interval`
  column executes against a real database
- **THEN** every delivered row carries `bigint` values as `bigint` and
  interval values structured, exactly as the single-select read does

### Requirement: Nested transactions run on savepoints
The `tx` handle a transaction callback receives SHALL itself provide a
transaction API that nests on the same connection: it SHALL issue a
`SAVEPOINT` before running its callback, `RELEASE SAVEPOINT` on normal
return, and `ROLLBACK TO SAVEPOINT` on a thrown error, rethrowing that
error unchanged. Rolling back a nested transaction SHALL NOT abort the
transaction containing it — the enclosing callback may catch the error
and continue issuing statements, and its own commit SHALL include
everything outside the rolled-back savepoint.

A callback that throws **synchronously** SHALL be handled identically to
one that rejects: its savepoint is rolled back and the error rethrown
unchanged.

No savepoint SHALL outlive the nested transaction that created it, on
any exit: a rolled-back savepoint SHALL also be released, so a
transaction that nests repeatedly does not accumulate savepoints for its
own lifetime. An enclosing callback may catch the error a nested
transaction raises and carry on, so an exit that ends in a throw is not
exempt.

Savepoint names SHALL be generated by the query layer and be distinct
within one transaction, for siblings and nested levels alike; they are
never caller-supplied.

Nesting SHALL NOT require a capability beyond the enclosing
transaction's own: a savepoint is only ever issued inside an already-open
interactive transaction.

#### Scenario: A nested transaction releases into its parent
- **WHEN** a `tx.transaction()` callback returns normally
- **THEN** its statements are released into the enclosing transaction and
  commit with it, on the same connection — no second `BEGIN` is issued

#### Scenario: A rolled-back nested transaction leaves its parent usable
- **WHEN** a `tx.transaction()` callback throws
- **THEN** the statements it issued are rolled back to its savepoint, the
  savepoint is released, the error is rethrown unchanged, and the
  enclosing callback can catch it and keep issuing statements that still
  commit

#### Scenario: A synchronous throw rolls back like a rejection
- **WHEN** a `tx.transaction()` callback throws before returning a
  promise
- **THEN** its savepoint is rolled back and released and the error is
  rethrown unchanged, exactly as for a rejected promise

#### Scenario: Sibling and nested savepoints do not collide
- **WHEN** one transaction contains a nested transaction inside another
  nested transaction, followed by a sibling nested transaction
- **THEN** each is bracketed by its own distinct savepoint name, released
  innermost-first

### Requirement: Concurrent nested transactions are rejected
Savepoints on one connection are strictly nested, so two nested
transactions on the same `tx` cannot be in flight at once: their
savepoint statements interleave, and a `ROLLBACK TO` on the older
savepoint destroys the newer one — discarding already-resolved work with
no error, or aborting the enclosing transaction with a "no such
savepoint" failure, depending on the interleaving.

Starting a nested transaction on a `tx` that already has one in flight
SHALL therefore fail immediately with `concurrent-nested-transaction`,
before any savepoint statement is sent, and its callback SHALL NOT run. The error
SHALL name sequential nesting — awaiting one nested transaction before
starting the next — as what to do instead.

Sequential nesting SHALL stay unaffected: once a nested transaction has
settled, the same `tx` accepts another.

#### Scenario: Concurrent siblings fail fast without data loss
- **WHEN** two nested transactions on the same `tx` are started
  concurrently
- **THEN** the second fails with an explicit coded error, its callback
  never runs, no savepoint statement for it reaches the database, and the
  first sibling's work is unaffected

#### Scenario: Sequential nesting still works
- **WHEN** a nested transaction settles and another is started on the
  same `tx`
- **THEN** it runs normally, on its own distinct savepoint

### Requirement: A failing savepoint release is recovered and reported
A statement error swallowed inside a nested callback leaves the
subtransaction aborted, so the `RELEASE SAVEPOINT` that follows a normal
return fails. The query layer SHALL attempt `ROLLBACK TO SAVEPOINT`
before giving up, and SHALL surface `savepoint-release-failed` carrying
the release failure as its cause. The error SHALL advise rethrowing inside
the nested callback rather than swallowing, since a swallowed statement
error is what puts the subtransaction in this state.

If the recovery rollback itself fails, the rollback-failure path SHALL
take over — that failure is about the connection, not about this one
savepoint — raising the savepoint-rollback-failure error carrying both
failures.

#### Scenario: A swallowed statement error surfaces at release
- **WHEN** a nested callback swallows a statement error and returns
  normally
- **THEN** the release fails, a rollback to the savepoint is attempted,
  the savepoint is then released so none outlives its nested
  transaction, and `savepoint-release-failed` is raised naming the
  swallowed error as the cause of the state and rethrow as the fix —
  never a bare `query-execution-failed`

#### Scenario: A failing recovery rollback falls through
- **WHEN** the release fails and the rollback attempted to recover from
  it also fails
- **THEN** the savepoint-rollback-failure error is raised, carrying both
  failures

### Requirement: The chain declares CTEs too
The chain surface SHALL offer `with()` as its own root, producing the same
statement node the core builder produces for the same declaration, and
SHALL execute it as one statement.

Result rows SHALL be converted by the body statement's own projection: a
statement wrapped in a `WITH` reads back exactly as the same body would
without one, brands and conversions included.

#### Scenario: A chain-built CTE compiles like the builder's
- **WHEN** the same CTE statement is expressed through the chain and
  through the core builder
- **THEN** the two compile to byte-identical SQL and the same parameter
  order

#### Scenario: Results convert through the wrapper
- **WHEN** a statement declaring a CTE projects a field whose type needs
  conversion
- **THEN** the value arrives converted, as it would in an unwrapped
  statement

### Requirement: Transactions are callback-scoped
The db handle SHALL provide a transaction API that runs a callback's
statements on one connection inside `begin`/`commit`, rolling back when
the callback throws, and requiring the driver's interactive-transaction
capability.

#### Scenario: Commit on success
- **WHEN** a transaction callback completes normally
- **THEN** its statements are committed atomically

#### Scenario: Rollback on throw
- **WHEN** a transaction callback throws
- **THEN** the transaction is rolled back and the thrown error
  propagates to the caller unchanged

### Requirement: Scalar result values convert to their declared type
A row value returned for a column with a declared type carrying its own
runtime conversion (numeric width mode, `interval`) SHALL be converted
to that declared TypeScript shape before the caller receives it. A value
that fails to convert, or a declared column entirely absent from the
driver's row, SHALL fail fast with an explicit error naming the column,
rather than surfacing as an unconverted value or a silent `undefined`.

#### Scenario: Declared numeric/interval columns arrive converted
- **WHEN** a select resolves a column declared with a numeric width mode
  or as `interval`
- **THEN** the value the caller receives matches that declared mode's
  TypeScript type (not the driver's raw text)

#### Scenario: An unconvertible or missing declared column fails fast
- **WHEN** a declared column's value cannot be converted to its declared
  type, or the declared column is entirely absent from the driver's row
- **THEN** the call rejects with an explicit error naming that column

### Requirement: Array results convert element-wise and arrive in the contracted shape
For an array column whose declared element type carries its own runtime
conversion, the conversion SHALL apply to each element, producing an
array of the declared element shape (a SQL `NULL` element passes through
as `null`, exactly as a `NULL` scalar does). An array column's raw value
that does not match the arrival shape its declared element type's driver
contract promises SHALL be treated as a conversion failure — fail fast
naming the column, never guessed at or coerced into the expected shape.
For a column declared `.notNullElements()`, a `NULL` element arriving at
all SHALL be treated as a conversion failure — the declared element type
excludes `null` because a CHECK enforces it, so an arriving `NULL` means
the constraint no longer holds (e.g. dropped out-of-band) and the
declared type must fail loudly rather than lie silently.

#### Scenario: Array columns arrive converted element-wise
- **WHEN** a select resolves an array column whose element type carries
  a runtime conversion (a moded `bigint`/`numeric` array, or an
  `interval` array)
- **THEN** the caller receives an array whose every non-null element
  has the declared element shape, and every `NULL` element is `null`

#### Scenario: An array arrival-shape mismatch fails fast, never partially converted
- **WHEN** an array column's raw value does not match the arrival shape
  its declared element type's driver contract promises (for example, a
  raw array-literal text value for an element type that is contracted
  to arrive as an already-parsed array, or the reverse)
- **THEN** the call rejects with an explicit error naming that column,
  and the caller never receives a partial array for it

#### Scenario: A NULL element under notNullElements fails fast
- **WHEN** a select resolves a `.notNullElements()` column whose raw
  driver value contains a `NULL` element (the backing CHECK was dropped
  or bypassed out-of-band)
- **THEN** the call rejects with an explicit error naming that column,
  and the caller never receives a `null` typed as the bare element type

### Requirement: A failed conversion fails the whole column value
Whether the failure is an unconvertible element, an arrival-shape
mismatch, unparsable array-literal text, or a `NULL` element where the
declaration forbids one, the column's whole value SHALL fail — never a
partial array standing in for it.

#### Scenario: No partial value survives a failed conversion
- **WHEN** one element of an array column's raw value fails to convert
  while the others would succeed
- **THEN** the call rejects naming the column, and no partially
  converted array is delivered

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
supplies none. A declaration the assertion did not compare — because the
kind that owns it declares its objects uncompared, or because the
comparison has no comparator for that kind — SHALL be reported by name
as not compared, carrying the reason that kind already states. Never silently skipped,
and never counted as matching: "the registry owns it" is not "it was
looked at". What the caller receives SHALL keep the two apart:
an object that was compared and an object that could not be SHALL
occupy different places in it, so "not counted as matching" is
observable rather than merely stated. The boundary SHALL be reported
whether or not anything diverged, so a caller can tell "nothing
differed" apart from "nothing was looked at".

"Could not answer" SHALL NOT be success. When nothing diverged but some
declaration could not be compared, the assertion SHALL fail by default
under `assert-schema-not-compared` — distinct from
`assert-schema-diverged`, which a real divergence raises — and its
remedy SHALL name what would actually make the answer possible: a stated
reason on the kind whose objects no comparator covers, the declarations
themselves where none were supplied. A
caller MAY opt out of that failure, and opting out SHALL change only
whether the assertion throws: the not-compared declarations SHALL still
be named in what the caller receives.

No registry makes a preset's own objects comparable here. The comparison
recognizes a fixed set of object kinds, and a kind outside that set is
reported, never compared — the same coverage the command-line check
already has. Widening that set belongs to the comparison, not to this
assertion.

Omitting a registry a declaration needs is not a quiet gap: the
assertion cannot even describe such a declaration, so it SHALL fail at
that point, before any comparison, under the declaration-ownership error
the snapshot builder already raises — propagated as it is, not
repackaged. Supplying the registry is therefore what turns an outright
refusal into a stated boundary, not what turns an uncompared object into
a compared one.

The uncovered-kind case has no instance in this repository today: the
comparison covers exactly the kinds the generic registry declares, so
reaching it takes a kind that registers itself and neither declares a
reason nor gains a comparator. The path is kept for the kind that will,
and is exercised by a fixture until then — it is future coverage, not
dead code, and deleting it because "this never happens" is the mistake
this paragraph exists to prevent.

Only a declaration that should have been compared triggers that failure.
A kind that states none of its objects is ever comparable is reported,
never failed on: it has no remedy to name, and failing on it would leave
opting out as the only way forward — which would silence the genuinely
uncompared declarations along with it, defeating this requirement.

A schema module that declares nothing is the same answerlessness and
SHALL fail the same way, preserving the underlying failure as its cause.
Its remedy SHALL name the actual fix — declarations — and never a
registry, which would not help a module that declares nothing at all.

These two codes name the assertion's own outcome, not an object's. The
per-object findings keep the codes the comparison already gives them —
`assert-schema-not-compared` is the run-level statement of the very fact
`hejbro check` reports per object as `check-not-compared`, and neither
code replaces the other. The per-object codes therefore keep their
`check-` prefix even when they travel inside an error a caller who never
ran that command receives: reusing the comparison's own vocabulary
outranks matching the prefix to the caller's entry point, and renaming
them would break the callers that already match on them.

Only a declaration that should have been compared and could not carries
the comparison's own not-compared code. A declaration whose kind states
that none of its objects is ever comparable carries that kind's reason
and no comparison code at all — the two facts share a place in the
report, not an identifier.

#### Scenario: A declaration outside the registry is named as not compared
- **WHEN** the schema module contains a declaration whose kind the
  supplied registry does not own
- **THEN** the assertion reports that declaration by name as not
  compared, and does not treat it as matching

#### Scenario: A registered kind that is not compared lands in the same place
- **WHEN** the registry owns the declaration's kind, but that kind
  declares its objects uncompared
- **THEN** the declaration is reported as not compared, carrying that
  kind's own stated reason — it never appears among the compared, and a
  run whose only gap is such a kind completes rather than failing

#### Scenario: Without its registry, a preset declaration is refused outright
- **WHEN** a schema module carrying a preset's declaration is asserted
  with no registry that owns that declaration
- **THEN** the assertion fails at declaration ownership, before reading
  the catalog, under the snapshot builder's own error and naming the
  declaration it cannot place — it does not silently treat it as
  uncompared

#### Scenario: Supplying the registry turns the refusal into a stated boundary
- **WHEN** the same module is asserted with the registry its preset
  contributes, and that preset's kind states its objects are never
  comparable
- **THEN** the run completes, and the declaration is named among what
  was not compared, carrying that kind's own reason

#### Scenario: Nothing diverged, but something could not be compared
- **WHEN** every compared object matches and some declaration was out of
  the registry's reach
- **THEN** the assertion fails under `assert-schema-not-compared`, not
  under the code a real divergence raises, naming each uncompared
  declaration and the registry that would cover it

#### Scenario: Opting out changes the failure, not the report
- **WHEN** the caller opts out of failing on uncompared declarations
- **THEN** the assertion completes, and what it hands back still names
  every declaration it could not compare

### Requirement: The assertion speaks in its caller's vocabulary
What the assertion throws SHALL be in its own caller's vocabulary. A
failure born on another surface — one whose code carries a command's
name — SHALL be translated into a code of the assertion's own, with the
original preserved as its cause. A failure already in the caller's
vocabulary — the snapshot builder's declaration diagnostic, a driver's
own error — SHALL be propagated unchanged, because there is nothing to
translate. Any new case is settled by one question: does that code name
something this library's caller invokes? This governs what the assertion
*throws*; the finding codes its report carries as *data* keep their own
names, for the reason the boundary requirement gives.

Each distinct translated failure SHALL get its own code, never a
borrowed one: an unreadable catalog is not the same fact as an
unanswerable comparison, so it fails under
`assert-schema-catalog-unreadable` and not under
`assert-schema-not-compared`.

The thrown error SHALL take the runtime layer's shape — a plain error
carrying a literal code and, where it translates another failure, that
failure as its cause — not the declaration-time error type, which has no
place to keep a cause and belongs to a different moment. A caller who
already catches errors from executing statements catches these the same
way.

What a failure carries SHALL be nameable. The per-object findings that
travel on a divergence are part of the contract, so the type of one is
exported under the assertion's own naming — structurally the shape the
comparison already produces, not a copy of it, and named for this
surface because a type first published here takes this surface's name
rather than the command's.

Every failure the assertion raises SHALL carry a `code`, and the `code`
is what a caller reads. The error's class is not part of the contract: a
propagated failure keeps whatever class it was raised with, because that
is what propagating means, so a caller branching on class would see only
half of them — and unifying the classes to "fix" that would undo the
propagation this requirement demands.

A reason the report carries is quoted from the comparison verbatim,
which means it may speak in terms of the command-line workflow — up to
and including telling the reader to rerun that command. The report SHALL
say so rather than edit the quotes: rewriting them would fork the
wording silently, and an unattributed instruction to run a command the
caller never ran is worse than an attributed one.

#### Scenario: A failure already in the caller's vocabulary is left alone
- **WHEN** the snapshot builder refuses a declaration no registered kind
  owns
- **THEN** the assertion lets that failure through exactly as raised —
  same code, same class, and no cause added, because adding one would be
  a repackaging

#### Scenario: A failure named for a command is translated
- **WHEN** the comparison refuses to read the catalog, under a code
  naming the command-line check
- **THEN** the assertion fails under its own catalog-unreadable code and
  keeps the original failure as the cause

#### Scenario: A module that declares nothing cannot answer either
- **WHEN** the handle was built from a schema module carrying no
  declarations at all
- **THEN** the assertion fails the same way as any other unanswerable
  run, keeps the underlying failure as its cause, and its remedy asks
  for declarations rather than for a registry

### Requirement: The assertion never reaches the filesystem
The assertion SHALL be usable from a deployed application, not only from
a command line: its module graph SHALL NOT reach the filesystem, the
process environment, or the command-line machinery. Every read it
performs SHALL go through the driver it was handed.

#### Scenario: The assertion's import graph is free of filesystem access
- **WHEN** the assertion module's transitive imports are walked
- **THEN** no filesystem, process, or command-line module appears among
  them
