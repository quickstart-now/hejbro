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

The assertion throws the runtime layer's error shape — a plain error
carrying a literal code and, where it translates another failure, that
failure as its cause — not the declaration-time error type, which has no
place to keep a cause and belongs to a different moment. A caller who
already catches errors from executing statements catches these the same
way.

Every failure this assertion raises carries a `code`, and the `code` is
what a caller reads. The error's class is not part of the contract: a
propagated failure keeps whatever class it was raised with, because that
is what propagating means, so a caller branching on class would see only
half of them — and unifying the classes to "fix" that would undo the
propagation the vocabulary rule requires.

A reason carried in the report is quoted from the comparison verbatim,
which means it may speak in terms of the command-line workflow — up to
and including telling the reader to rerun that command. The report
SHALL say so rather than edit the quotes: rewriting them would fork the
wording silently, and an unattributed instruction to run a command the
caller never ran is worse than an attributed one.

A translated failure gets a code of the assertion's own naming, one per
distinct failure it translates — an unreadable catalog is not the same
fact as an unanswerable comparison and SHALL NOT borrow its code.

What the assertion **throws** SHALL be in its own caller's vocabulary.
A failure born on another surface — one whose code carries a command's
name — SHALL be translated into the assertion's own code with the
original preserved as its cause. A failure already in the caller's
vocabulary — the snapshot builder's declaration diagnostic, a driver's
own error — SHALL be propagated unchanged, because there is nothing to
translate. Any new case is settled by one question: does that code name
something this library's caller invokes? This is why the empty-module
failure is rewrapped and the declaration-ownership failure is not, and
it does not reach the finding codes the report carries as *data*, which
keep their own names for the reason given above.

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
