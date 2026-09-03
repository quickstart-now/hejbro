# Delta: cli-commands

## ADDED Requirements

### Requirement: import writes starter declarations from a database
The CLI SHALL provide an `import` command that reads a database through
the catalog (connection from `--url`, else `DATABASE_URL`, never from
`hejbro.config.ts` — the rule `check` follows) and writes one starter
declaration file per schema into a directory the command names,
refusing to overwrite any existing file. The schemas to read SHALL be
named explicitly — `--schema`, repeatable, with no default — and a run
that names none SHALL refuse with a coded diagnostic that shows the
common answer; a database's schemas include its platform's own
(`auth`, `storage` and their neighbours on a hosted Postgres), and
adopting those as declarations is not a default anyone can want. The
destination SHALL be named explicitly too (`--out`, no default), and a
run whose named schemas hold nothing to infer — or nothing it can
declare, every one of them omitted for its own name — SHALL say so with
its own code, a different code for each of those two reasons, rather
than writing empty files, and SHALL leave the destination untouched,
creating not even the directory. Where the reason is omission, the
report's `Omitted:` lines SHALL be printed with the refusal: that a
schema was found and could not be carried is the one useful thing such
a run has to say, and it is not the same statement as "nothing is
there". The files SHALL declare what
the reading inferred with the DSL's own builders, and the command SHALL
print the loss report. A column the DSL cannot name SHALL be omitted
from the starter files and named in the loss report with the reason it
could not be carried — and the two reasons are different and SHALL be
told apart: either no declaration key produces that SQL name back (the
DSL derives a column's SQL name from its key by snake_case, so a quoted
`"createdAt"` has no key that yields it), or a key does produce it back
and the DSL's own identifier rule rejects the name itself, as it
rejects the leading-underscore `_id`. The consequence is the same for
both and SHALL be stated with the line: the table is only partly
declared, and `check` reports that column until it is renamed in the
database. Renaming is the only way out there is, and the report SHALL
offer no other — the DSL derives every column's SQL name from its
TypeScript key and accepts no explicit name beside it, so no
hand-written declaration can carry either kind of name, in this
repository or in a linked one. A foreign key's own catalog name SHALL survive into the starter
declaration — written out where it differs from the name the DSL would
derive, left implicit where it does not — because `check` compares
foreign keys by name, and a database hejbro did not create names them
its own way. A catalog name D36 cannot carry at all is the one
exception: that key is declared under the derived name and the report
announces the approximation, since a foreign key's name is a label on a
constraint the declaration still expresses, not the constraint's own
identity. The starter files' imports SHALL never form
a cycle — and a reference to another file's enum counts as an import,
exactly as a foreign key to another file's table does: where a cycle
would form, the crossings in one direction are declared against
unexported reference-only declarations, a handle for a table and a
local copy of the enum for an enum. A foreign key into a table no
starter file declares — one whose schema this run never named — SHALL
be declared against such a handle too, for a different reason: there is
no file to import its target from. A starter file therefore never names
a table this run did not read except through a handle of its own, and it
SHALL carry one handle per target rather than one per foreign key,
however many of its keys point there: a handle names a table, not a
relation, and the reading that produces them counts them the same way —
two artifacts of one reading that count the same thing differently
disagree about which of them is right. No
identifier a starter file declares or imports SHALL collide with a name
the file's own emitted text already binds, the extras callback's own
parameter included: a table whose identifier would collide with it is
declared under another identifier instead, because a shadowed reference
inside a callback resolves to that callback's column proxy rather than
to the table, and the file then loads as nothing at all — a failure that
reaches the reader as a load error naming the file, never as a report
line about the table. Each
file SHALL
open with a header carrying
the loss report in full and the statement that the file is the
repository's own from now on, and SHALL carry no clock- or
machine-derived value, so importing the same database twice writes
byte-identical files. After an `import`, `baseline` SHALL emit the DDL that creates what the
database already has, marked in its own banner as describing objects
that already exist, so that `migrate` registers that migration rather
than runs it; `baseline` refuses once a project has any migration, so
it is not something `generate` prepares work for. A `generate` against
the same empty snapshot would emit the same statements, as a migration
meant to run.

#### Scenario: Declaration files never import each other in a cycle
- **WHEN** two schemas' files would reference each other — by foreign
  key, by a column typed with the other file's enum, or one of each —
  so their imports would form a cycle
- **THEN** the crossings in one of the two directions are declared
  against reference-only declarations that are not exported, whatever
  their columns and actions: a handle for a table, a local copy for an
  enum, so the files' imports form no cycle, nothing is declared twice,
  and loading does not depend on which file the loader reaches first

#### Scenario: A table named like the emitted callback's parameter still loads
- **WHEN** a reading covers a table whose identifier would collide with
  the parameter the emitted extras callback binds — the table declared in
  the file that references it, the table imported from another file, or
  the table on the declared side of a cut cycle
- **THEN** each of the three files is written with that table under an
  identifier that does not collide, and each loads through the loader
  `generate` itself uses and type-checks, in every entry order

#### Scenario: A second import writes the same bytes
- **WHEN** the same database is imported twice, into two empty
  directories
- **THEN** the two sets of files are identical byte for byte, and each
  file's header carries the loss report and says the file is the
  repository's own from now on

#### Scenario: A database is imported into starter files
- **WHEN** `hejbro import --url <db> --out src/schema --schema app
  --schema billing` runs against a database holding both
- **THEN** two declaration files are written, the loss report is
  printed, and a following `baseline` emits a first migration whose
  objects match the database's, marked in its banner so that `migrate`
  registers it rather than runs it

#### Scenario: a column the DSL cannot name is left out and said so
- **WHEN** a table holds a column whose SQL name no declaration key can
  produce, such as a quoted `"createdAt"` (the DSL derives a column's
  SQL name from its key by snake_case)
- **THEN** the starter file leaves that column out, the loss report
  names it and its table, gives that column's own reason — no
  declaration key produces that SQL name back — and states the
  consequence: the table is only partly declared, and `check` reports
  that column until it is renamed in the database

#### Scenario: a column the DSL rejects by name is left out the same way
- **WHEN** a table holds a column named `_id`, whose inferred key
  produces that same SQL name back but whose name the DSL's own
  identifier rule rejects
- **THEN** the run completes exactly as it does for a name no key can
  produce — the starter file leaves that column out, the loss report
  names it with its table and consequence, and every other column of
  that table is declared — but the report gives this column's own
  reason, that the identifier rule rejects a name a key does produce
  back, rather than saying no key produces it

#### Scenario: import refuses to guess which schemas to read
- **WHEN** `hejbro import --url <db> --out src/schema` runs with no
  `--schema`
- **THEN** it fails with a coded diagnostic that names `--schema` and
  shows the common answer, and writes nothing

#### Scenario: The named schemas hold nothing to infer
- **WHEN** every schema named by `--schema` holds no table, enum or
  sequence the reading can infer
- **THEN** it fails with its own coded diagnostic naming those schemas,
  and writes no files at all

#### Scenario: Every named schema was omitted for its name
- **WHEN** every schema named by `--schema` holds objects, but each
  schema's own catalog name is one no declaration can carry
- **THEN** it fails with a code of its own — not the one for schemas
  that are empty, since the two say different things — its output
  carries the `Omitted: schema …` line for each of them with what to do
  about it, and the destination directory is not created

#### Scenario: import never overwrites
- **WHEN** the output directory already holds a file `import` would
  write
- **THEN** it fails with a coded diagnostic naming the file and writes
  nothing

### Requirement: pull reads a database as the marked fallback
The CLI SHALL provide `pull --db-url <url>` that feeds a catalog reading
to the same contract emitter `vendor` uses, writes the contract with an
origin naming the database rather than a commit, and prints the loss
report naming `link` as the way out. It SHALL use no other source of
schema than the catalog, and SHALL name the schemas to read the way
`import` does — `--schema`, repeatable, with no default, for the same
reason: a hosted database's own platform schemas are never what a
consumer meant to contract against. Its destination is not named on the
command line at all: the contract goes where `vendor` puts it.

#### Scenario: A contract is pulled from a database
- **WHEN** `hejbro pull --db-url <db> --schema public` runs
- **THEN** a contract is written whose header says it was inferred from
  a database, whose `Tables` are the inferred tables with guessed keys,
  and the loss report is printed
