## ADDED Requirements

### Requirement: A set-shaped array is recorded in canonical order
A snapshot array whose members form a set — an order the database never
reads — SHALL be recorded in one canonical order that does not depend on
the order the declaration listed its members in: a policy's `roles`
sorted by name; a trigger's `events` in the fixed order insert, update,
delete, with an `update` event's column list sorted by name; a table's
`indexes` and `checks` sorted by name. Two declarations that differ only
in the order of such an array SHALL serialize to byte-identical nodes.

An array whose order the database reads SHALL keep the order it carries
today: a table's columns (physical order), an index's columns, a foreign
key's local and referenced column lists, a function's arguments, an
enum's values, a view's column list, and every expression or statement
node. A grant's privileges and a table's foreign keys are already
canonical and stay so.

`formatVersion` SHALL stay 8: no key is added or removed, and a snapshot
written before this order was canonical is read as it is — how it
compares is the diff's own rule.

#### Scenario: Declarations differing only in a set's order serialize identically
- **WHEN** two declarations of one object list the same members of a
  set-shaped array in different orders — a policy's roles, a trigger's
  events, an update event's columns, a table's indexes, a table's checks
- **THEN** the two serialized nodes are byte-identical

#### Scenario: An ordered array keeps its declared order
- **WHEN** a table's columns, an index's columns, a foreign key's column
  lists, a function's arguments, or an enum's values are declared in a
  given order
- **THEN** the snapshot records that order, and reversing it is the
  change it always was — a reversed enum value list still diffs as a
  recreate, a reversed index column list still diffs as a changed index

#### Scenario: The format version does not move
- **WHEN** a declaration is snapshotted under this rule
- **THEN** `formatVersion` is 8 and no node carries a key it did not
  carry before
