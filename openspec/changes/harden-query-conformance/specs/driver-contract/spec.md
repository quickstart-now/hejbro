## MODIFIED Requirements

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
ending a transaction are all seen. A statement is classified by the
whitespace-delimited word its own text leads with, and a string is never
split on `;`. A statement that only manipulates a
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
