# catalog-inference delta — harden-check-inventory

## MODIFIED Requirements

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

Where a line names an object the reading left out of the declarations,
the consequence it states SHALL be what hejbro will actually do about
that object afterwards. A line SHALL NOT say that hejbro will never
mention the object again where `check` will keep naming it, and SHALL
NOT promise that `check` will report it where `check` will not: the loss
report is the one place a user is told what the omission costs, and a
report that is wrong about that costs more than the omission it
announces. Which objects `check` keeps naming is `check`'s own
inventory rule (`cli-commands`), not a second rule stated here.

#### Scenario: The report names the way out
- **WHEN** `pull --db-url` completes
- **THEN** its output names the guessed facts and says the loss ends
  when the consumer links the schema repository

#### Scenario: An omitted object's line says what check will do about it
- **WHEN** a reading omits an index and a check constraint whose catalog
  names no declaration can carry, on a table it still declares, and the
  loss report is printed
- **THEN** each line names the object and states that `check` keeps
  listing it as unmanaged until it is renamed in the database, rather
  than that hejbro will not mention it again
