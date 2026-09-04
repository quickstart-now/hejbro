## ADDED Requirements

### Requirement: A set's order is never a snapshot movement
Where `generate` decides whether the snapshot moved, and where `verify`
decides whether the checked-in snapshot matches the declarations, two
snapshots that differ only in the order of a set-shaped array — a
policy's roles, a trigger's events and an update event's columns, a
table's indexes and checks — SHALL count as identical. A run whose
declarations differ from the checked-in snapshot only by such an order
SHALL write neither a migration nor a snapshot and report the no-change
line, and `hejbro verify` SHALL pass over that pair; the canonical order
reaches the file with the next run that has something to record. This
qualifies "identical" in the generation rule and "matches your
declarations" in the verification rule, and nothing else in either.

The hash chain is untouched by this: the tip migration's recorded hash
is still compared against the snapshot file's canonical serialization —
every value and every order, though not its formatting — so a hand edit
of the snapshot that changes a value or reorders a set is still reported
as a tip mismatch. What changes is only the comparison of the file against the
declarations, which reads both through the canonical form.

#### Scenario: A reorder-only difference writes nothing and verifies
- **WHEN** the checked-in snapshot lists a policy's roles, a trigger's
  events, or a table's indexes or checks in one order, the declarations
  list the same members in another, and `hejbro generate` then `hejbro
  verify` run
- **THEN** `generate` writes nothing and reports the no-change line, and
  `verify` passes with exit code zero

#### Scenario: A hand-reordered snapshot is still a tip mismatch
- **WHEN** the snapshot file's own roles array is reordered by hand, so
  its canonical serialization no longer hashes to the tip migration's
  `snapshot:` line, and `hejbro verify` runs
- **THEN** it fails naming the tip migration and the snapshot path, as
  it does for any hand edit

#### Scenario: The next real change writes the canonical order
- **WHEN** the checked-in snapshot carries a set-shaped array in a
  non-canonical order and a run adds a column to any table
- **THEN** the migration carries that column's statement and nothing
  else, and the written snapshot lists every set-shaped array in
  canonical order
