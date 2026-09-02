# Delta: schema-export

## ADDED Requirements

### Requirement: The export carries existing tables as such
The schema description SHALL carry each existing table the schema
declares — one built with `existingTable()`, declared for its shape and
never managed — with the same facts it carries for a managed one:
export name, column keys, numeric modes, element nullability. It SHALL
mark the table existing, so a reader can offer it for reading and
joining and never for migration. A description written before that mark
existed SHALL read as carrying only managed tables.

#### Scenario: An existing table survives the round trip
- **WHEN** a schema declaring an existing table is exported and read
  back
- **THEN** the table is recovered with its declared columns and their
  facts, marked existing

#### Scenario: A description written before the mark reads as managed
- **WHEN** a description written before the existing mark was added is
  read
- **THEN** it is accepted, and every table in it reads as managed
