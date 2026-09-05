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

The inventory SHALL be ordered by the identity each line names, so two
runs against the same database print the same report and two databases
holding the same objects print them in the same order.

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
