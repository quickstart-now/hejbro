## MODIFIED Requirements

### Requirement: A reset destroys only what the declarations manage
The CLI SHALL provide a command that returns a database to the state
before any migration was applied, insofar as the declarations still
describe what was applied, and it SHALL drop only objects the
declarations describe. Objects the declarations do not cover are
reported as inventory elsewhere in this product on the stated grounds
that a project may legitimately leave objects unmanaged; a reset that
dropped them would destroy what this tool says it does not own. When an
applied object is no longer declared, these two SHALLs bind reset to the
second one: a survivor from the drifted object collides with the chain
the next `migrate` re-applies, and that collision is the drift's own
consequence, not a defect in either SHALL.

Before evaluating anything else, reset SHALL refuse a declaration set
that describes no objects, with its own coded error, before any
statement reaches the database — the same misconfiguration `check` and
`baseline` already refuse, naming the entry point as what to check.

Reset SHALL refuse unless the destruction is confirmed explicitly, and
the refusal SHALL name what would be dropped. The confirmation SHALL be
an exact `<database>:<count>` token, supplied via `--confirm-drop` and
bound to the connected database's own name — queried live, never
assumed from configuration — and the number of objects that would be
dropped; binding it to the database's own name is what stops a
confirmation learned against one database from silently passing,
unchanged, against a different one with the same object count.

A run computing no changes needs no confirmation, since there is nothing
to name — but the refusal above already keeps that state unreachable:
every registered object kind reports a drop whenever it disappears from
a non-empty declaration set (code-certain, not verified by execution),
so a declaration set that survives the refusal above can never diff to
zero changes. The ledger is therefore cleared only together with the
drops it records, so no unconfirmed destructive path remains.

Where more than one declared object would be dropped, the order SHALL be
the reverse of the dependency order the snapshot itself describes — never
`cascade`, which could remove an object the declarations do not describe
and so would break the first paragraph's own promise. This order SHALL
hold both across kinds (a view, a policy, a trigger, and a sequence, all
before their own table — for the sequence at the statement level, since
the column default it backs is dropped by a statement of its own; a table
before its own schema) and within a kind,
for a foreign key from one declared table to another: a table that
references another declared table SHALL drop before the table it
references, so a declared object is never dropped while another object
this same run is also dropping still depends on it existing. Where two
declared tables reference each other, no order satisfies both, so they
SHALL drop in their existing identity order instead, and a resulting
refusal from the database is reported through the coded failure the next
paragraph states.

This is the same dependency graph generation computes (cli-commands),
read in the opposite direction — a dependent before what it depends on —
never the literal reverse of whatever statement sequence one specific
generation run happened to emit.

A drop that fails SHALL leave the database and the ledger exactly as
they were: the drops and the ledger's own clearing run inside one
transaction, so a failure partway through rolls all of it back, and the
failure SHALL be reported as a hejbro-coded error carrying the
database's own reason — never surfaced as an unclassified, uncaught
failure.

After a reset, the ledger SHALL hold no row for a migration whose
objects were dropped, so the next run applies the chain from its
beginning.

#### Scenario: An unmanaged table survives a reset
- **WHEN** a database holds a declared table and a table no declaration
  covers, and reset runs
- **THEN** the declared table is dropped and the unmanaged one is left
  standing

#### Scenario: An empty declaration set is refused before anything is sent
- **WHEN** `reset` runs on a project whose declarations load but export
  nothing
- **THEN** it fails with its own coded error, and no statement reaches
  the database

#### Scenario: Reset refuses without confirmation
- **WHEN** reset runs without the confirmation it requires
- **THEN** it refuses with a coded error naming what it would have
  dropped, and drops nothing

#### Scenario: A reset clears the ledger for what it dropped
- **WHEN** reset completes and `migrate` runs afterwards
- **THEN** the chain is applied from its first migration

#### Scenario: A referencing table drops before the table it references
- **WHEN** a database holds two declared tables in their own declared
  schema, one carrying a foreign key to the other, and `reset` runs with
  the confirmation it requires
- **THEN** all three objects — both tables and the schema — are gone
  afterward and the run exits zero, whichever order their names would
  otherwise sort in

#### Scenario: A failed drop leaves the ledger and status telling the truth
- **WHEN** a drop `reset` sends fails — for example, an object outside
  the declarations still depends on the one being dropped
- **THEN** `reset` exits non-zero with a coded error carrying the
  database's own reason, the database is unchanged, and `hejbro status`
  run afterward still reports every previously-applied migration as
  applied
