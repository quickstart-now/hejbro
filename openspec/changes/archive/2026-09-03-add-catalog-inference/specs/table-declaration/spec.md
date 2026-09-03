# Delta: table-declaration

## ADDED Requirements

### Requirement: A foreign key can carry the name the database already gave it
A table-level foreign key declaration SHALL accept its own constraint
name, and the snapshot SHALL carry that name instead of the derived
`<table>_<columns>_fk`. A declaration that names none keeps the derived
name, so every existing declaration emits exactly the SQL it emitted
before. This is the slot an index (`index("…")`) and a check
(`check("…", …)`) already have, and it exists for the same reason: a
database hejbro did not create names its constraints its own way —
Postgres's own default is `<table>_<columns>_fkey` — and `check`
compares foreign keys by name, so a declaration that cannot say the real
name reports every foreign key on such a database as missing, forever.

#### Scenario: A named foreign key keeps its name
- **WHEN** a table declares a foreign key with an explicit name
- **THEN** the snapshot and the emitted SQL use that name, and no
  derived name appears for it

#### Scenario: An unnamed foreign key is unchanged
- **WHEN** a table declares a foreign key without a name
- **THEN** the derived name is used, and the emitted SQL is byte for
  byte what it was before this slot existed

#### Scenario: Renaming the table leaves an explicit name alone
- **WHEN** a table carrying an explicitly named foreign key is renamed
- **THEN** the foreign key keeps the name the declaration gave it, while
  a derived one moves with the table
