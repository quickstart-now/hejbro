# Delta: schema-export

## ADDED Requirements

### Requirement: The export carries unmanaged tables as such
The schema description SHALL carry each unmanaged table the schema
declares with the same facts it carries for a managed one — export
name, column keys, numeric modes, element nullability — and SHALL mark
it unmanaged, so a reader can offer it for reading and joining and
never for migration.

#### Scenario: An unmanaged table survives the round trip
- **WHEN** a schema declaring an unmanaged table is exported and read
  back
- **THEN** the table is recovered with its declared columns and their
  facts, marked unmanaged
