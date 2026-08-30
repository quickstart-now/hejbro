## MODIFIED Requirements

### Requirement: The check states the boundary of its own coverage
`check` SHALL state, in its own report, what it did not compare. A
checker silent about its blind spots is read as a guarantee it never
made.

`check` SHALL NOT pass an object it could not actually compare. When a
comparison cannot be carried out — a privilege is missing, an expression
could not be rendered — that object SHALL be reported as **not compared,
with the reason**, and SHALL NOT be counted as agreeing. A false "no
differences" is worse than a false difference: it is the silent failure
this command exists to end, reintroduced by the command itself.

Two things equally leave an object out of a definite agree/differ
answer, and `check` states them differently, never as one blurred
category. A kind that states, as part of its own extension interface,
that no catalog object will ever back its declared objects is not a
comparison that failed — it is a comparison this command was never going
to attempt. `check` SHALL state that once, by the kind's own declared
reason, in its coverage-boundary section, and SHALL NOT affect the exit
code on its account: not a `Finding`, and not counted as agreeing
either. An object this command should have compared and could not — a
missing privilege, an unrenderable expression, or a declared kind this
build does not recognize — remains the other category: reported **per
object**, not compared, with the reason, and SHALL NOT let the run exit
zero.

"Not compared" SHALL NOT be used where a plainer finding is true: an
object that is genuinely absent from the database is *missing*, not
uncomparable. Missing takes precedence, so a declared table that does not
exist is reported once, as absent, rather than a second time for every
comparison its absence made impossible.

The report SHALL state that view bodies are not compared, and that a
declared object is checked for existence even where its contents are
not.

It SHALL also state that its reads are not taken as a single snapshot.
Opening no transaction is what keeps this command free of any driver
capability, and the cost of that choice is that a schema changing while
`check` runs can produce a torn report — a blind spot this command's own
rules oblige it to name rather than leave for a user to discover.

#### Scenario: The report names what was not compared
- **WHEN** `check` completes, whether or not it found differences
- **THEN** the report states the axes it does not compare, so a passing
  result is not read as a guarantee it does not make

#### Scenario: An uncomparable object is never silently passed
- **WHEN** the database elides or refuses what a comparison needed
- **THEN** that object is reported as not compared, with the reason,
  rather than counted as agreeing

#### Scenario: A kind that declares itself uncomparable states its own boundary line
- **WHEN** a declared object's kind states, in its own extension, that no
  catalog object will ever back it
- **THEN** `check` states that once in its coverage-boundary section,
  naming the kind's own declared reason, and the exit code is unaffected
  by it

#### Scenario: An unregistered kind is reported as not compared, never as differing
- **WHEN** a declared object's kind is not one this build recognizes
- **THEN** `check` reports it as not compared, with the reason, and the
  run cannot exit zero on the strength of a comparison that never ran

#### Scenario: A catalog read that fails stops the run
- **WHEN** a catalog read fails outright
- **THEN** `check` stops with a coded error naming that failure, and no
  object is reported as absent on the strength of a read that never
  succeeded

#### Scenario: An absent object is reported once
- **WHEN** a declared table does not exist, so every comparison that
  depended on it could not be carried out either
- **THEN** `check` reports the table as missing and does not additionally
  report each dependent comparison as not compared

#### Scenario: The report does not claim a consistent snapshot
- **WHEN** `check` completes
- **THEN** the report states that its reads were not taken as a single
  snapshot, so a schema changed mid-run can produce a torn result
