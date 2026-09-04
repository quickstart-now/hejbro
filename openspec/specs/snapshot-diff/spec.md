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
