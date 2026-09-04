## ADDED Requirements

### Requirement: A statement beside an in-flight nested transaction is rejected
While a nested transaction started from a `tx` is in flight, the
connection's next statements belong to the nested callback's own `tx`: a
statement issued through any other `tx` of the same transaction — the
one that started the nested transaction, or any `tx` above it — lands
inside the nested savepoint and shares its fate, rolled back with it
when the nested callback throws, with no error. The query layer SHALL
therefore refuse such a statement immediately with
`statement-during-nested-transaction`, before it is sent, whether it
comes from `execute`, a chain member, or `with`. The refusal is decided
where the statement is sent — a chain built earlier and awaited while a
nested transaction is in flight is refused then, and never at chain
construction, which sends nothing. The error SHALL name the two ways
out: issue the statement through the nested callback's own `tx` when it
belongs to that work, or await the nested transaction first when it
does not. The nested transaction's own work SHALL be unaffected by the
refusal.

A `tx` handed to a nested callback is that nested transaction and
nothing else: once its callback has settled, its savepoint no longer
exists, and a statement issued through it — or a nested transaction
started from it — would land in the enclosing transaction unbracketed.
Either SHALL be refused with `statement-after-nested-transaction`,
before anything is sent, naming the enclosing `tx` as where it belongs.

The `tx` a transaction callback itself received is that transaction and
nothing else, by the same rule: once the callback has settled — the
transaction committed or rolled back — its connection has gone back to
the pool, and a statement issued through the kept handle would run on
whatever connection the driver hands out next, outside any transaction,
committing on its own with no error. Such a statement, a chain awaited
through that handle, or a nested transaction started from it, SHALL be
refused with `statement-after-transaction`, before anything is sent,
naming a new `transaction()` call as the way to run more work.

Sequential use stays unaffected: once a nested transaction has settled —
released or rolled back — the `tx` that started it accepts statements
again. Starting a second nested transaction beside one in flight keeps
its own refusal, `concurrent-nested-transaction`.

#### Scenario: A statement beside a nested transaction is refused and the nested work survives
- **WHEN** `tx.execute(statement)` is started while a nested transaction
  from the same `tx` is in flight
- **THEN** the statement is refused with
  `statement-during-nested-transaction`, never reaches the connection,
  and the nested transaction completes its own work and releases its
  savepoint exactly as it would have alone

#### Scenario: A chain awaited beside a nested transaction is refused at the send
- **WHEN** a chain member is built on a `tx` and awaited while a nested
  transaction from that `tx` is in flight
- **THEN** building the chain refuses nothing, the await is refused with
  `statement-during-nested-transaction`, and nothing for it reaches the
  connection

#### Scenario: Every tx above the nested transaction is refused alike
- **WHEN** a nested transaction is in flight two levels down and a
  statement is issued through the outermost `tx`
- **THEN** it is refused with `statement-during-nested-transaction`,
  exactly as a statement through the `tx` that started the nested
  transaction is

#### Scenario: A nested handle used after its callback settled is refused
- **WHEN** the `tx` a nested callback received is kept and, after the
  nested transaction released or rolled back, a statement is issued
  through it, or a nested transaction is started from it
- **THEN** each is refused with `statement-after-nested-transaction` and
  nothing reaches the connection — no statement, no savepoint

#### Scenario: A transaction's own handle used after it settled is refused
- **WHEN** the `tx` a `transaction()` callback received is kept and, after
  that transaction committed — or rolled back on a thrown error — a
  statement is issued through it, a chain built on it is awaited, or a
  nested transaction is started from it
- **THEN** each is refused with `statement-after-transaction`, nothing
  reaches any connection, and no row the refused statement would have
  written exists in the database afterwards

#### Scenario: Sequential use after a settled nested transaction still works
- **WHEN** a nested transaction settles — by releasing, or by rolling
  back on a caught error — and the `tx` that started it then issues a
  statement, then starts another nested transaction
- **THEN** both run normally, on the same connection, the statement
  outside any savepoint and the new nested transaction on its own
