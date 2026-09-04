# snapshot-diff Specification

## Purpose
What the change list `diffSnapshots` computes from two snapshots
promises — which changes appear, how many times each, and in what
order — to the kinds that feed it, built-in and preset alike. The
contract of the extension interface's `diff` and `dependsOnIdentities`
stages as seen from the migration they end up in.

## Requirements

### Requirement: Every change a kind reports reaches the change list
`diffSnapshots` SHALL carry every change a kind's `diff` reports into
the ordered change list exactly once — never dropping one and never
repeating one — including when a kind reports more than one change for
the same identity in the same direction: two creates, two alters, or two
drops for one object. The extension interface lets a kind's `diff`
return any number of changes, and a kind that uses that freedom is owed
each of them in the migration.

The same-kind dependency refinement — which reorders a kind's creates,
and separately its drops, by the identities its nodes depend on — SHALL
treat same-identity changes as one unit: placed where their shared
identity belongs, adjacent to each other, in the order the kind reported
them. The refinement's own ordering rules are unchanged by this; a kind
that takes no part in the refinement is untouched by it.

#### Scenario: Two same-direction changes for one identity both survive
- **WHEN** a kind that takes part in the same-kind refinement reports,
  for one identity, two creates, three alters, or two drops
- **THEN** the change list carries each of them exactly once, in the
  order the kind reported them, and no other change is affected

#### Scenario: Same-identity changes move together where their identity belongs
- **WHEN** such a kind reports two creates for an object that depends on
  another object of the same kind whose identity sorts after it
- **THEN** the change list places the dependency first and then both
  creates of the dependent, adjacent and in reported order

#### Scenario: A create and a drop for one identity keep their own partitions
- **WHEN** such a kind reports a create and a drop for one identity
- **THEN** the create is in the create/alter partition and the drop in
  the drop partition, each exactly once, as before

#### Scenario: A kind outside the refinement is unaffected
- **WHEN** a kind that does not declare same-kind dependencies reports
  two changes for one identity
- **THEN** the change list carries both, as it already did

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
