## REMOVED Requirements

### Requirement: Context execution requires transactions
**Reason**: its scenario "A preset's one-shot driver refuses a context"
states the inverse of what this change ships — a one-shot driver that
declares batched transactions applies the context in one batch. The
rule survives with the batched form admitted, below.
**Migration**: none for callers on an interactive driver; a call that
used to fail on the Neon HTTP driver now runs.

### Requirement: A provider handle requires the interactive-transaction capability
**Reason**: the name states one capability; the rule now admits two.
Restated below with the same fail-before-the-resolver guarantee.
**Migration**: none.

## ADDED Requirements

### Requirement: Context execution requires a transaction, interactive or batched
Executing under a context SHALL run the context's statements and the
caller's statement inside one transaction, by one of two forms decided
by the driver's declaration alone: on a driver with interactive
transactions, inside `transaction()` exactly as before; on a driver
without them but with batched transactions, as one batch whose members
are the context rendering's statements — the same statements, from the
same built-in or contributed rendering, in the same order — followed by
the caller's statement, resolving the last member's rows. Interactive
transactions win where both are declared. On a driver with neither, the
call SHALL fail with the missing-capability error naming both keys
before any statement is sent — never by falling back to a
connection-level setting, and never by executing the caller's statement
unscoped. `db.as(context).transaction(callback)` SHALL keep requiring
interactive transactions on every driver: a callback is interactive by
definition.

#### Scenario: Context on an interactive driver
- **WHEN** `db.as(context)` executes on a driver declaring interactive
  transactions
- **THEN** the statements sent are exactly those sent before this
  change, inside one `transaction()`

#### Scenario: Context on a batched-only driver
- **WHEN** `db.as(context)` executes a statement on a driver declaring
  interactive transactions `false` and batched transactions `true`
- **THEN** the driver's `batch` receives the context rendering's
  statements followed by the caller's statement, in that order, once,
  and the call resolves the caller's rows

#### Scenario: A preset's one-shot driver applies the context in one batch
- **WHEN** `db.as(context)` is used on a provider preset's driver built
  for a one-shot connection path that declares batched transactions
- **THEN** the context reaches the database in the same batch as the
  statement, the role and settings are transaction-local to that batch,
  and a following batch without a context carries none of them

#### Scenario: Context on a driver with neither form
- **WHEN** `db.as(context)` executes on a driver declaring both
  interactive and batched transactions `false`
- **THEN** the call fails naming both missing capabilities and nothing
  reaches the database

#### Scenario: A callback stays interactive
- **WHEN** `db.as(context).transaction(callback)` is called on a
  batched-only driver
- **THEN** the call fails naming `interactive-transactions`, as before

#### Scenario: A failing batch is reported as a batch
- **WHEN** a member of the batch raises — a context statement or the
  caller's own, indifferently
- **THEN** the failure names the batch and lists every member that was
  sent, in order, states that the driver does not report which member
  failed, and carries the driver's own error unchanged as the cause —
  it never asserts that one particular member is the one that failed

#### Scenario: The interactive path still names the failing statement
- **WHEN** a context statement raises on a driver with interactive
  transactions
- **THEN** the failure names that statement alone, exactly as it did
  before this change: a path that sends one statement at a time knows
  which one failed, and says so

### Requirement: A provider handle requires a transactional capability
Executing on a handle with a registered provider SHALL take the same
two forms as `db.as(context)`, decided by the same declaration, and on
a driver with neither form SHALL fail with the same missing-capability
error naming both keys, on the first execution. The capability SHALL be
asserted before the resolver is called, so the failure is a property of
the driver alone and does not depend on whether the caller's auth layer
answered.

#### Scenario: A missing capability fails before the resolver runs
- **WHEN** a statement is executed on a provider handle whose driver
  declares neither interactive nor batched transactions
- **THEN** the execution fails naming both capabilities, the resolver is
  never called, and nothing reaches the database

#### Scenario: A provider handle batches on a batched-only driver
- **WHEN** a statement is executed on a provider handle whose driver
  declares batched transactions only
- **THEN** the resolver is consulted once, and the driver's `batch`
  receives the resolved context's statements followed by the caller's
