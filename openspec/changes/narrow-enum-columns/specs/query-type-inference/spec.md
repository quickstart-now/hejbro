# query-type-inference (delta)

## ADDED Requirements

### Requirement: Enum columns type as their declared values
A column declared from `pgEnum(schema, name, values)` SHALL read back as
the union of those values and SHALL accept only those values as a write,
in every position that resolves a declared column's type — a whole-table
select, a `returning` projection, and insert/update input alike.
Nullability remains the column's own axis: a value union widens with
`| null` exactly when the column is not `notNull`.

The values SHALL reach the type without being restated by the user. A
declaration that records no values SHALL keep typing as `string` rather
than narrowing to an empty union, so an enum whose values are not
statically known stays usable.

#### Scenario: A declared enum reads as its values
- **WHEN** a table declares `status: postStatus.column().notNull()` from
  `pgEnum(app, "post_status", ["draft", "published"])`
- **THEN** a whole-table select's row type reads `status` as
  `"draft" | "published"`, not `string`

#### Scenario: An undeclared value fails to type-check as a write
- **WHEN** an insert or update writes a string that is not one of the
  declared values to that column
- **THEN** it fails to type-check, rather than compiling and being
  rejected by the database at runtime

#### Scenario: Nullability stays a separate axis
- **WHEN** the same enum column is declared without `notNull`
- **THEN** its read type is the value union widened with `| null`
