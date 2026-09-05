# cli-commands delta — harden-check-inventory

## MODIFIED Requirements

### Requirement: Objects the declarations do not manage are reported, not failed on
`check` compares in one direction: from the declarations to the database.
An object that exists in the database and in no declaration is therefore
invisible to every comparison above, and a user who reads a passing
`check` as "my declarations cover this database" would be wrong.

`check` SHALL report, as information and not as a difference, the
extensions the database has and every object the database holds inside
the declared schemas that no declaration covers: a table, and — on a
table the declarations manage — a column, an index and a check
constraint. This SHALL NOT affect the exit code: these objects are not
errors, and a project may legitimately leave objects unmanaged.

The table alone is not enough, and stopping there was the blind spot this
requirement exists to close. A column, an index or a check constraint the
database holds on a table hejbro manages is exactly the object a reader
of a passing `check` believes is covered, and `import` tells the user in
its own loss report that `check` keeps naming what a declaration could
not carry. All three kinds are reported by one rule: a kind reported on
one axis and silently dropped on another would state a coverage the
command does not have.

This inventory is existence only, by identity. Nothing in it reads a
type, a default or an expression, so nothing in it can report a
difference that is not one, and nothing in it is a `Finding`.

Its boundaries are what keep it from naming an object twice, or naming
one where nothing true can be said:

- an object is inventoried only when the table holding it is one the
  declarations manage. A table no declaration covers is itself reported,
  once, and the objects it holds SHALL NOT be listed under it — the table
  line already says everything true about them.
- a table declared with `existingTable()` is outside this inventory
  entirely, its columns, indexes and check constraints included, exactly
  as the table itself already is: such a declaration claims a shape
  hejbro does not own, so nothing on it is hejbro's to call unmanaged.
- a schema no declaration touches stays out of scope, for objects exactly
  as for tables: hejbro has nothing to say about a schema this project
  never mentions.
- an index that backs a constraint the declarations name — a declared
  primary key, a declared unique column — SHALL NOT be reported as an
  unmanaged index. The declaration accounts for it, under that
  constraint's own name, and Postgres creates it with that name; a
  database hejbro's own migration produced would otherwise report an
  unmanaged index for every key it declared. Which constraint an index
  backs SHALL be read from the catalog's own record of it, never
  inferred from the two names matching — and the record to read is the
  constraint the index *implements*. A foreign key's own catalog record
  names the index it points at on the referenced table; read without
  that distinction, a key another table references is reported as
  unmanaged once for every foreign key pointing at it, each time under
  that foreign key's name. Any other index the catalog
  holds on a managed table is inventoried — and where such an index
  backs a constraint, its line SHALL name that constraint, so that a
  reader is not sent looking for an index nobody wrote.

The inventory SHALL be ordered by the identity each line names, and
ordered by that identity's UTF-16 code units — not by a collation,
whether the database's or the machine's. What the rule needs is a total
order that no locale can vary and in which no two distinct names ever
compare equal; code-unit order is exactly that, and it coincides with
code-point order for every identity outside the astral planes. A report
ordered by a collation is
ordered differently on two machines that disagree about locale, and two
identities a collation treats as equal have no order at all between
them, which is the same defect one step further in. Every axis of the
inventory follows this one rule, so that two runs against the same
database print the same report, and two databases holding the same
objects print them in the same order whatever order the catalog
returned them in.

Extensions are reported because their absence is silent and expensive: a
declaration whose default calls `gen_random_uuid()` needs `pgcrypto`, and
nothing in the declared set records that.

#### Scenario: An unmanaged table is reported without failing
- **WHEN** the database has a table in a declared schema that no
  declaration covers, and everything declared agrees
- **THEN** `check` lists that table as unmanaged and exits zero

#### Scenario: A column the database holds and no declaration covers is reported without failing
- **WHEN** a table the declarations manage holds a column no declaration
  covers — including one `import` omitted because no declaration could
  carry its name — and everything declared agrees
- **THEN** `check` names that column by its schema, table and name as
  unmanaged, reports no difference for it, and exits zero

#### Scenario: An index and a check constraint the database holds on a managed table are reported without failing
- **WHEN** a table the declarations manage holds an index and a check
  constraint no declaration covers, and everything declared agrees
- **THEN** `check` names each of them by its schema, table and name as
  unmanaged, reports no difference for either, and exits zero

#### Scenario: An index backing a declared key is not called unmanaged
- **WHEN** the declarations declare a primary key and a unique column,
  hejbro's own migration for them is applied, and `hejbro check` runs
- **THEN** no inventory line names the indexes Postgres created for those
  two constraints, and the run exits zero

#### Scenario: An unmanaged index that backs a constraint names that constraint
- **WHEN** a table the declarations manage carries a primary key or a
  unique constraint no declaration names, and `hejbro check` runs
- **THEN** `check` reports that constraint's own index as unmanaged,
  naming the constraint it backs beside the index's identity, and exits
  zero

#### Scenario: An unmanaged table's own objects are not listed under it
- **WHEN** the database has a table in a declared schema that no
  declaration covers, holding columns, indexes and check constraints
- **THEN** `check` reports that table once, as unmanaged, and reports no
  inventory line for any object it holds

#### Scenario: An existing declaration's own objects are never inventoried
- **WHEN** a schema declares a table with `existingTable()` and the
  database's table of that name holds columns, indexes and check
  constraints beyond what the declaration names
- **THEN** no inventory line names the table or any object on it, and the
  exit code is unaffected

#### Scenario: The inventory is ordered the same way on every run
- **WHEN** `hejbro check` runs twice against a database holding several
  unmanaged columns, indexes and check constraints
- **THEN** both runs print the same inventory lines in the same order

#### Scenario: The order does not depend on a collation
- **WHEN** two databases hold the same unmanaged objects, created in
  different orders — including two whose names a collation treats as
  equal without being the same name — and `hejbro check` runs against
  each, under two different locales
- **THEN** all four runs print the inventory lines in the same order

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
database **and declared**. Renaming is what makes the name one a
declaration can carry, and the report SHALL offer no other way to get
there — the DSL derives every column's SQL name from its
TypeScript key and accepts no explicit name beside it, so no
hand-written declaration can carry either kind of name, in this
repository or in a linked one. Renaming alone SHALL NOT be stated as
the end of the reporting: a renamed column is a column the declarations
still do not carry, and `check` goes on naming it as unmanaged until
they do. A foreign key's own catalog name SHALL survive into the starter
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
  that column until it is renamed in the database and declared

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
