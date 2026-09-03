# Delta: catalog-inference

## Purpose

Defines what hejbro infers when it reads a live database catalog
instead of declarations, which facts it guesses, which it does not
infer at all, and how it announces the loss — the one reading shared by
`import` and `pull --db-url`.

## ADDED Requirements

### Requirement: A catalog reading yields a snapshot and a marked description
Reading a database through the catalog SHALL yield a snapshot of the
schemas named — tables with columns, defaults, identity and generated
markers, primary keys, foreign keys, checks and indexes; enum types;
and the sequences an identity or serial column owns, carried as that
column rather than as sequences of their own — through read-only
catalog queries: `check`'s own inventory
queries plus the column-, constraint-, index- and enum-detail queries
inference needs on top of them, all read-only, none writing to the
database. It SHALL also yield a schema description whose
declaration-time facts are guessed by the rules stated here, and whose
guessing the loss report announces: a column's TypeScript key from its
SQL name by lower-casing
it and joining the runs between non-alphanumeric characters in camel
case, keeping leading underscores and prefixing `_` to a key that would
otherwise start with a digit, with collisions resolved by leaving the
bare key to the one colliding column whose SQL name that key produces
back — the column a declaration can still name — and appending to each
other colliding key the smallest integer from 2 upwards that leaves it
free, so an exotic sibling never costs an ordinary column its own key;
the default numeric mode; unknown element nullability read as
nullable; and role names from the grants present. The
description SHALL be built from the catalog reading directly, so every
column the reading found is carried with a guessed key; a declaration
round trip is not its source, and a column that no declaration can
express is therefore still described — described, but never contracted:
a contract carries the columns the snapshot holds, and a column the DSL
cannot name never reaches the snapshot. The snapshot SHALL hold no
function, trigger, policy expression, view body, grant beyond its role
name, column whose type no column builder expresses, standalone
sequence that no column owns — the DSL has no `defineSequence()` (D66)
— or column, table, schema, index or check whose catalog name no
declaration can carry, since a declaration's identifiers are lower
snake_case (D36) while a database hejbro did not create names its
objects its own way. A name is one a declaration can carry exactly
when core's own identifier rule accepts it and the key inferred for it
produces that name back — the DSL's own rule, consulted, never a second
rule predicting it, since two rules that disagree is precisely how a
reading stops where it should have omitted: a quoted `"createdAt"`
fails both halves, while a leading-underscore `_id` passes the round
trip and fails the rule — the very case a rule predicting the DSL's
answer got wrong — and both are omitted and named. A table or schema left out for a name
no declaration can carry takes the objects it holds with it, and the
foreign keys that point at it: a surviving declaration SHALL never
reference an object this reading omitted for its name, and the report
SHALL never announce an approximation for one. A target that lies
outside the schemas the run named is a different case and SHALL be
kept: it was not omitted but unread, and its own name may be one a
declaration carries perfectly well — such a reference SHALL survive
into the starter declarations and into the contract alike, carried as a
reference to a table this repository does not declare, with nothing
said about it in the loss report, since nothing was lost. The reading
SHALL carry such a target in the snapshot it yields as a table it names
but does not declare, so that neither consumer of one reading loses the
reference: the starter declarations name it through a reference-only
handle they do not export, and the contract names it through the
relation and the foreign-key metadata. The contract SHALL NOT give that
target an entry of its own among its tables — a table this run never
read has no column set and no types the contract could state without
guessing at them, and a contract that guesses is worse than one that
says only what it knows. Which tables
a reading kept is therefore never what decides a reference's fate;
whether the target's own name can be carried is — a hosted database's
platform schemas are exactly the ones a run leaves unnamed, so reading
scope as omission would drop the most ordinary reference such a
database has. Leaving an object out for its name SHALL never stop the
reading — everything else in the named schemas is still inferred — and
the loss report SHALL name each of them. A column named there is
still described: the description records what the database holds, and
the snapshot records what a declaration can express.

#### Scenario: Tables and enums are inferred
- **WHEN** a database holding two schemas with tables, foreign keys
  between them, a check, an index and an enum type is read
- **THEN** the snapshot records each of them with its columns, keys and
  constraints, and the enum with its values, and the loss report says
  the TypeScript keys were guessed

#### Scenario: Two SQL names that collide on one key are both described
- **WHEN** a table holds `user_id` and a quoted `USER_ID`, whose
  TypeScript keys collide
- **THEN** the description carries both columns — the one a declaration
  can still name under the bare key, the other under the key with the
  collision suffix, whichever of the two comes first physically — and
  the loss report names the column that cannot be declared, since only
  one of the two can be named by a declaration

#### Scenario: A name no declaration can carry costs that object, not the run
- **WHEN** a named schema holds a table whose catalog name is not lower
  snake_case, beside tables whose names are
- **THEN** the reading still yields the other tables, the starter files
  and the contract are still written, and the loss report names the
  omitted table with its schema and says what to do about it — and the
  same holds for an index or a check whose name a declaration cannot
  carry, which costs that index or check alone

#### Scenario: A reference into an omitted object is omitted with it
- **WHEN** a surviving table holds a foreign key whose target table, or
  whose target schema, is one this reading left out for its name
- **THEN** the reading still completes, that one foreign key is left out
  of the surviving table's declaration while its other keys stay, the
  loss report names the foreign key together with the omitted object it
  points at and what to do about that object, and no approximation is
  announced for anything the reading omitted

#### Scenario: A reference into a schema the run did not name is kept
- **WHEN** a table in a named schema holds a foreign key into a table in
  a schema the run did not name, whose schema and table names a
  declaration can carry
- **THEN** the reading keeps that foreign key: the starter declaration
  references its target through a reference-only handle it does not
  export, the pulled contract carries the reference both as a relation
  and in its foreign-key metadata while giving that target no entry of
  its own among its tables, the loss report says nothing about it, and a
  following `baseline` emits the constraint with the rest — while no
  starter file is written for the schema the run never named

#### Scenario: No approximation is announced for an object omitted for its name
- **WHEN** a table the reading keeps carries a UNIQUE constraint whose
  own name no declaration can carry, and a column whose name no
  declaration can carry holds a `nextval` default
- **THEN** the report names each of them as omitted and announces no
  approximation for either — while an ordinary UNIQUE constraint on that
  same table is still announced as the unique index it becomes, so the
  rule removes the contradiction without silencing the report

#### Scenario: Two tables sharing a constraint name keep their own expressions
- **WHEN** two tables in one schema each carry a check constraint of the
  same name, which Postgres allows because a constraint name is unique
  per table rather than per schema
- **THEN** each table's snapshot carries its own expression, so the DDL
  that would recreate them asserts each check against the table whose
  columns it names

#### Scenario: What is not inferred is named
- **WHEN** the database also holds a function, a trigger, a view, a
  column whose type no column builder expresses, and a sequence no
  column owns
- **THEN** none appears in the snapshot, the loss report names each kind
  as not inferred, and it names that column with its type and that
  sequence by name

### Requirement: The loss is announced, with the way out
Every command that uses a catalog reading SHALL print a loss report
naming what was guessed (keys, modes, element nullability), what was
not inferred, every approximation the reading made — a UNIQUE
constraint is inferred as a unique index carrying the constraint's own
name, so re-creating it emits `create unique index` rather than
`add constraint … unique`; a `nextval` default on a sequence the column
does not own is kept as a raw default, naming that sequence;
expressions are carried as raw SQL text rather than as the typed
builders a hand-written declaration would use; a foreign key whose own
catalog name D36 cannot carry is declared under the derived name,
naming both — and the command that
removes the loss:
linking the schema repository for `pull`, hand-editing the starter
declarations for `import`.

#### Scenario: The report names the way out
- **WHEN** `pull --db-url` completes
- **THEN** its output names the guessed facts and says the loss ends
  when the consumer links the schema repository
