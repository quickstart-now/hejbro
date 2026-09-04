## MODIFIED Requirements

### Requirement: Declarations can be checked against a live database
The CLI SHALL provide a `check` command that compares the declared
snapshot — built in memory from the declarations, exactly as `generate`
and `verify` build it — against the catalog of a live database, and
reports where the two disagree.

`check` SHALL issue only statements that read: catalog queries and
`EXPLAIN` without `ANALYZE`, which plans a statement without running it.
It SHALL NOT write, create a database, open a transaction, change session
state, or require any privilege beyond reading the catalog and the
objects it compares. This command is not an apply path, and its
read-only-ness is a property of the statements it can issue rather than
of a transaction mode it sets.

The database SHALL be named by a `--url` flag, else by the
`DATABASE_URL` environment variable. It SHALL NOT be read from
`hejbro.config.ts`: that file is committed, and a connection string
carries a secret.

`check` is a different question from `verify` and SHALL stay a separate
command. `verify` asks whether the migration chain on disk is intact
against the snapshot; `check` asks whether the snapshot describes the
database that actually exists. Folding them together would make one
failure mean two unrelated things.

What `check` compares, per declared object, is the following — this list
is the complete comparison surface, and a comparison added later SHALL be
added to it:

- existence, by identity
- for a column: its type and its `notNull`; then, for a column that is
  not generated, its default; for a generated column, whether the
  database's column is generated too, and its expression (through the
  server's own rendering, its own requirement below). A default is never
  compared for a column generated on either side: a generated column
  cannot carry one, so a difference reported on that axis would be a
  difference the user cannot act on
- for an expression-bearing object (a check constraint, an index
  predicate, an index's expression columns, a generated column): the
  expression, through the server's own rendering (its own requirement
  below)
- for a check constraint additionally: whether the database enforces it
  (`NOT VALID` is reported even when the expression matches)
- for an index additionally: the number of keys in its ordered key list,
  and every key position at which either side is an expression, through
  the server's own rendering (its own requirement below). A position at
  which both sides are plain columns, an index's uniqueness and its
  access method are not compared beyond the index's existence
- for a grant declared over *all tables in a schema*: the tables the
  declarations cover, not every table the schema happens to contain (a
  table hejbro does not declare is inventory, never a finding: hejbro
  cannot emit a migration for it, so reporting it as a difference would
  hand the user a failure with no fix — and the grant hejbro does emit
  is a one-shot statement that never covered that table either)

Its exit code SHALL distinguish three answers, because "the database
disagrees with you" and "I could not find out" are different facts and a
caller automating this needs to tell them apart: **zero** when everything
compared agreed, **one** when any declared object is missing or differs,
and **two** when the run could not answer — anything reported as not
compared, or a declaration set that was empty. Two is never silence: the
report still names each object it could not compare and why.

A run that could not compare something SHALL NOT exit zero. A checker
that answers "no differences" when it never looked is the failure this
command exists to end.

Where a column differs on more than one axis, `check` SHALL report all
of them from one run. Reporting only the first would make the user fix
it, run again, and meet a second difference in the same column — the
tool drip-feeding what it already knew.

`check` SHALL refuse to report a clean result for an empty declaration
set: zero declared objects means every comparison is vacuous, which is
never a real pass and is almost always the wrong path or entry point. It
SHALL fail with its own error code, distinct from an ordinary
difference's, and exit two.

#### Scenario: A column whose real type differs is reported
- **WHEN** a declaration types a column `text` and the database has it as
  `varchar(120)`, and `hejbro check` runs
- **THEN** it reports that column by its schema, table and name, states
  the declared type and the type the database has, and exits non-zero

#### Scenario: A matching database passes
- **WHEN** every declared object exists in the database with the declared
  type, nullability and default
- **THEN** `check` reports no differences and exits zero

#### Scenario: An empty declaration set is refused
- **WHEN** `hejbro check` runs against declarations that load but export
  nothing
- **THEN** it fails with its own error code and exit code two rather than
  reporting zero differences, naming the declaration entry points as what
  to check

#### Scenario: A matching generated column is not reported
- **WHEN** a declaration holds a column `generated always as (price * qty)
  stored`, the database holds that column generated with the same
  expression, and `hejbro check` runs
- **THEN** no finding names that column — in particular none about a
  default — and, every other object agreeing, the run exits zero

#### Scenario: A column generated on one side only is reported on that axis
- **WHEN** a declaration holds a generated column and the database holds
  a plain column of that name, or the declaration holds a plain column
  and the database holds it generated
- **THEN** `check` reports that column as differing, stating which side
  is generated, and reports no finding on its default axis

### Requirement: An expression is compared through the server's own rendering
Where `check` compares an expression through the server's rendering — a
check constraint's expression, an index's predicate, an index's
keys, a generated column's expression — it SHALL obtain
the rendering of **both** the declared expression and the database's own
expression from **one statement**, and compare those. The four surfaces
SHALL be compared by one rule: the same statement form, the same fallback
where no rendering can be obtained, the same reporting of what could not
be compared. An expression `check` knows how to compare on one surface
and leaves uncompared on another would report as present what it never
looked at.

An index is compared as an ordered key list. The declared keys and the
database's keys are paired by position, and every position at which
either side is an expression is compared through the rendering — a plain
column renders as itself, so a declared expression the server stores as a
plain key (a bare column reference, a parenthesized column, a column with
a collation) agrees with the database that hejbro's own migration
produced, and a declared plain column against a database expression
differs. The database's key text carries its collation where that
collation is not the column's default, so a declared `col collate "C"` is
paired with what the database actually holds; the server's rendering
drops a collation from both sides alike, so a difference in collation
alone is not visible through the rendering and is not reported — the
same limit that leaves a key's sort direction and operator class
uncompared. A key list whose length
differs is reported as differing on the count, in either direction, and
no rendering is probed for it; a predicate present on one side only is
reported as differing the same way, in either direction. Every declared
index reaches this comparison, whether or not the declaration itself
carries a predicate or an expression: a filter on the declared side alone
would pass a database index that grew a predicate or an expression the
declaration never had. A position at which both sides are plain columns
is not compared by this requirement or any other beyond the index's
existence, nor are an index's uniqueness and access method.

One statement, not two sent to one connection: a driver is free to pool
connections, so two statements can land on two sessions whose
`search_path` or other settings differ, and the deparse this comparison
rests on is sensitive to exactly those settings. "Same session" is
unenforceable from outside the driver — a single statement makes it true
by construction instead, and costs a round trip less. It also stays
within the no-capability rule: pinning a connection any other way means a
transaction. One object's expressions — an index's predicate and its
keys — MAY share one statement; two objects' never need to.

Comparing hejbro's rendered text against the catalog's text directly is
not permitted where a rendering can be obtained. Postgres rewrites an
expression when it stores it, so the two texts differ for expressions
that agree: measured against `examples/postgres`, 8 of 8 check
constraints differed textually while being identical in meaning.

This comparison is syntactic equality of the server's own rendering. It
is not a proof of semantic equivalence, and reordered operands are
reported as a difference — hejbro's own snapshot diff treats a reordered
declaration as a change too.

The rendering SHALL be obtained in a way that does not depend on how the
database chooses to execute anything, and that row-level security cannot
suppress. An expression compared as a query *predicate* fails both:
the planner may place it differently depending on the indexes and
statistics that happen to exist, and row-security rewriting can remove it
entirely, which makes two genuinely different expressions compare equal.

Existence takes precedence over this comparison, as it does everywhere in
`check`: an index or a column that is absent from the database is
reported once, as missing, and its expression is not additionally
reported as uncomparable.

On a platform whose registered preset declares that the server cannot
plan a statement, no rendering can be obtained. There, and only there,
`check` SHALL compare the declared expression's text with the catalog's
own text after a fixed normalization — whitespace outside string
literals, one parenthesis pair enclosing the whole text, the enclosing
table's qualifier on a column reference, identifier quoting where the
identifier would render unquoted anyway, a type cast the server appended
to a string literal, and letter case outside quoted identifiers and
string literals — and nothing else, on every one of the four surfaces, each compared key
position of an index normalized on its own. Texts equal after that normalization SHALL count as
agreeing. Texts that still differ SHALL be reported as **not compared**,
carrying both texts and a `Next:` that names restating the declaration in
the catalog's own spelling; they SHALL NOT be reported as differing,
because a textual difference is not evidence of a different meaning. The
`Next:` line SHALL NOT ask the user to run or be granted `EXPLAIN` on such
a platform. The report's coverage boundary SHALL state that the run
compared expressions by normalized text. On a platform whose presets make
no such declaration, a failure to obtain the rendering remains reported
exactly as before.

Wherever a diagnostic carries an expression text — a declared or a catalog
expression in a not-compared finding, both renderings in a differing
finding — the text SHALL be delimited by a character that is not one of
SQL's own quote characters (`"`, `'`): a table-bound expression begins
with a double-quoted identifier, so a double quote as the delimiter is
indistinguishable from the text it delimits. Error codes and `Next:`
lines are unaffected by the delimiter.

Whether the database **enforces** a check constraint is compared
separately from its expression. A constraint the database is not
enforcing on existing rows states a weaker invariant than the declaration
claims, and its expression matches all the same.

#### Scenario: An expression that differs only by Postgres's rewriting passes
- **WHEN** a declared check constraint uses `in (...)` or `between`, and
  the database stores the rewritten form
- **THEN** `check` reports no difference for that constraint

#### Scenario: An expression that genuinely differs is reported
- **WHEN** a declared check constraint bounds a column at 5 and the
  database's constraint bounds it at 4
- **THEN** `check` reports that constraint as differing

#### Scenario: Row-level security does not hide a difference
- **WHEN** the connected role has no policy on the table an expression
  belongs to, and that expression genuinely differs
- **THEN** `check` still reports it as differing, rather than reporting
  agreement because the database declined to evaluate anything

#### Scenario: A constraint the database does not enforce is reported
- **WHEN** the database holds a declared check constraint as `NOT VALID`
- **THEN** `check` reports it, stating that existing rows are not
  enforced, even though its expression matches the declaration

#### Scenario: A partial index's predicate that differs only by rewriting passes
- **WHEN** a declared partial index's predicate renders
  `"tasks"."status" <> 'done'` and the database holds the index with
  `WHERE (status <> 'done'::text)`
- **THEN** `check` reports no difference for that index

#### Scenario: A partial index whose predicate genuinely differs is reported
- **WHEN** a declared partial index's predicate is `archived_at is null`
  and the database's index of that name carries `archived_at is not null`
- **THEN** `check` reports that index as differing, naming it by schema,
  table and name

#### Scenario: An expression index whose expression matches passes
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on `lower(email)`
- **THEN** `check` reports no difference for that index

#### Scenario: An expression index whose expression differs is reported
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on `upper(email)`
- **THEN** `check` reports that index as differing

#### Scenario: A key that is an expression on one side only is reported in either direction
- **WHEN** a declared index is on `lower(email)` and the database's index
  of that name is on the plain column `email` — or the declared index is
  on the plain column `email` and the database's index of that name is on
  `lower(email)`
- **THEN** `check` reports that index as differing at that key position,
  in either direction

#### Scenario: An index whose key count differs is reported on the count
- **WHEN** a declared index has two keys and the database's index of that
  name has three, or the reverse
- **THEN** `check` reports that index as differing, stating both key
  counts, and no rendering is probed for it

#### Scenario: A declared expression the server stores as a plain key is not a difference
- **WHEN** a declaration's index key is a bare column reference, a
  parenthesized column, or `col collate "C"` written as an expression, the
  migration hejbro generated for it is applied, and `hejbro check` runs
- **THEN** it reports no difference for that index, because the
  database's key renders as the same thing the declaration renders as

#### Scenario: An index partial on one side only is reported in either direction
- **WHEN** a declared index carries a predicate and the database's index
  of that name carries none, or the declared index carries none and the
  database's index of that name carries `where archived_at is null`
- **THEN** `check` reports that index as differing, stating which side is
  partial, and no rendering is probed for it

#### Scenario: A generated column whose expression matches passes
- **WHEN** a declared column is `generated always as (price * qty) stored`
  and the database holds it generated with an expression the server
  renders identically
- **THEN** `check` reports no difference for that column

#### Scenario: A generated column whose expression differs is reported
- **WHEN** a declared column is generated as `price * qty` and the
  database's column of that name is generated as `price + qty`
- **THEN** `check` reports that column as differing on its expression

#### Scenario: A missing index is reported once, never as uncomparable
- **WHEN** a declared partial index does not exist in the database
- **THEN** `check` reports it as missing and does not additionally report
  its predicate as not compared

#### Scenario: Under a preset that declares no planning, equal normalized texts agree
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders
  `length(btrim("projects"."name")) > 0`, and the catalog holds
  `(length(btrim(name)) > 0)`
- **THEN** `check` reports no difference for that constraint, and its
  coverage boundary states that expressions were compared by normalized
  text on this run

#### Scenario: Under a preset that declares no planning, a rewritten expression is not compared
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"role" in ('owner', 'admin')`, and
  the catalog holds `(role = ANY (ARRAY['owner'::text, 'admin'::text]))`
- **THEN** `check` reports that constraint as not compared, carrying
  both texts, with a `Next:` that names restating the declaration in the
  catalog's spelling and never mentions `EXPLAIN`, and the run does not
  exit zero

#### Scenario: Under a preset that declares no planning, a string literal's content is never normalized
- **WHEN** a registered preset declares the platform cannot plan a
  statement, the declaration renders `"projects"."format" <> '"json"'`,
  and the catalog holds `(format <> 'json'::text)`
- **THEN** `check` reports that constraint as not compared: no
  normalization step rewrites the inside of a string literal, so the
  quoted word in the literal and the qualifier-like text a literal may
  carry stay exactly as written on both sides

#### Scenario: Under a preset that declares no planning, a failed catalog read is not compared without asking for EXPLAIN
- **WHEN** a registered preset declares the platform cannot plan a
  statement, and reading the constraint's own expression from
  `pg_constraint` fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, and its `Next:` names the catalog read to confirm
  and never asks the user to run or be granted `EXPLAIN`

#### Scenario: Under a preset that declares no planning, an index predicate and a generated column follow the same text rule
- **WHEN** a registered preset declares the platform cannot plan a
  statement, a declared partial index's predicate renders
  `"tasks"."archived_at" is null` while the catalog holds
  `(archived_at IS NULL)`, and a declared generated column renders
  `"widgets"."price" * "widgets"."qty"` while the catalog holds
  `(price * (qty)::numeric)`
- **THEN** `check` reports no difference for the index, reports the
  generated column as not compared carrying both texts with a `Next:`
  that never mentions `EXPLAIN`, and no `explain` statement reaches the
  server for either

#### Scenario: Without such a declaration, a failed rendering is reported as before
- **WHEN** no registered preset declares the platform cannot plan a
  statement, and the rendering statement fails
- **THEN** `check` reports the constraint as not compared with the
  server's own reason, exactly as it does today, and never compares by
  text

#### Scenario: A reported expression text is delimited apart from SQL's quotes
- **WHEN** a declared expression renders `"posts"."role" = 'owner'` and
  `check` reports it as not compared, or reports both renderings of a
  differing expression
- **THEN** each expression text in the diagnostic is enclosed by a
  delimiter that is neither `"` nor `'`, so the text's own leading quoted
  identifier is not mistaken for the end of the delimited text, and the
  finding's code and `Next:` line are the same as before
