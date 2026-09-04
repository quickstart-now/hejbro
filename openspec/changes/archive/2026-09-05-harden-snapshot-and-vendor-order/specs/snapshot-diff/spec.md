## ADDED Requirements

### Requirement: A set-shaped array's order never makes a change
`diffSnapshots` SHALL compare a set-shaped array — a policy's `roles`, a
trigger's `events` and an update event's column list, a table's
`indexes` and `checks` — as a set: two nodes that differ only in the
order of such an array are unchanged, so no alter and no drop-and-create
is reported, whichever side carries the uncanonical order. A snapshot
written before the canonical order existed therefore compares equal to
the canonical serialization of the same declarations, and a run whose
only movement is such an order SHALL generate nothing — no statement,
and no migration recording the rewrite; the canonical bytes reach the
snapshot on disk with the next run that has something to record.

A change inside a set-shaped array — a member added, removed, or
altered — SHALL still be reported exactly as it is today.

#### Scenario: Reordering a set-shaped array generates nothing
- **WHEN** the declarations are unchanged except that a policy's roles,
  a trigger's events, an update event's columns, a table's indexes, or a
  table's checks are listed in a different order
- **THEN** the change list is empty and `generate` writes no migration

#### Scenario: A snapshot written before the canonical order compares equal
- **WHEN** the previous snapshot carries such an array in a non-canonical
  order and the declarations still list the same members
- **THEN** the change list is empty, the run records no snapshot
  movement, and the next run that has a change to record writes the
  canonical order

#### Scenario: A member change is still a change
- **WHEN** a role is added to a policy, an event is removed from a
  trigger, or an index is renamed, whatever order the arrays are in
- **THEN** the change list carries the same alter it carried before, with
  the same notes
