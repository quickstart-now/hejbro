# snapshot-format Specification

## Purpose

The on-disk snapshot files hejbro writes next to generated migrations:
their format version and what a column snapshot records, so that
diffing against an unchanged declaration is exact and version skew
fails loudly instead of silently.

## Requirements

### Requirement: A snapshot records the declared schema completely at format version 8
Snapshot files SHALL carry `formatVersion: 8` and SHALL record the
declared schema completely enough that diffing an unchanged declaration
against its own snapshot is exactly empty. A column snapshot SHALL
record the column's type, nullability, default, and — as optional
fields absent on ordinary columns, the compact-snapshot convention — a
stored generated column's expression (as the encoded expression
fragment) and an identity column's kind and any explicit sequence
options. A table snapshot's foreign keys SHALL be recorded in the
canonical declaration-form-independent order (local columns, then
target identity), so the bytes never depend on WHICH declaration form
wrote an edge. A serialized select — a view's body — SHALL record every
clause the builder can express, `offset` and `distinct` included
(`distinct` as `null` when absent rather than an always-present
wrapper). A hejbro older than the snapshot it reads SHALL fail with the
newer-format diagnostic; a hejbro newer than the snapshot it reads
SHALL fail with the older-format diagnostic and its pin-or-reset
guidance rather than silently ignoring or misreading fields.

#### Scenario: The generated family survives a snapshot round-trip
- **WHEN** a table declaring generated and identity columns is
  snapshotted and the snapshot is read back
- **THEN** the diff against the unchanged declarations is empty — the
  expression text, identity kind, and explicit options all round-trip

#### Scenario: A view body's offset and distinct survive a round-trip
- **WHEN** a view whose body carries `offset` and `distinct on` is
  snapshotted and the snapshot is read back
- **THEN** the diff against the unchanged declaration is empty, rather
  than the clauses being dropped and the view diffed as if it had neither

#### Scenario: An older reader refuses a version-8 snapshot loudly
- **WHEN** a hejbro whose snapshot format is older than 8 reads a
  version-8 snapshot
- **THEN** it fails with the newer-format diagnostic naming the version
  mismatch, never a diff computed with the new clauses ignored

#### Scenario: A version-7 snapshot is refused as older, loudly
- **WHEN** this build reads a version-7 snapshot
- **THEN** it fails with the older-format diagnostic and its
  pin-or-reset guidance, never a mis-diff over the missing clauses

### Requirement: A stored view body may declare CTEs
The snapshot's stored query vocabulary SHALL include the `with` statement
node, so a view whose body declares CTEs is storable and comparable like
any other view. A new statement-node discriminator is vocabulary, not a
format change: adding one SHALL NOT change `formatVersion`, the precedent
`select-expr` and `set-op` set.

Existing declarations' serialization SHALL be unchanged, byte for byte. A
new statement node adds a key to no existing encoded object; a diff in a
golden or an example snapshot means something else moved and is
investigated rather than regenerated.

The stored subset SHALL remain select-only. A `with` node whose body or
whose entries are anything other than a select or a set operation has no
snapshot form — mutations never reach a snapshot.

#### Scenario: A view declaring a CTE is stored and compared
- **WHEN** a view whose body declares a CTE is snapshotted, and the same
  declaration is snapshotted again
- **THEN** the two snapshots are identical and the diff is empty

#### Scenario: Existing snapshots do not move
- **WHEN** a declaration containing no CTE is snapshotted
- **THEN** its encoded form carries no `with`-related key at all — the
  vocabulary's presence leaves every other declaration's bytes untouched
  — and `formatVersion` is unchanged

### Requirement: An order term's nulls placement is recorded additive-compact
An `OrderByTerm`'s encoded form SHALL carry a `nulls` key only when an
explicit placement (`"first"` or `"last"`) was declared, and SHALL omit
it entirely otherwise — never an always-present key defaulted to `null`.
Decoding an encoded order term with no `nulls` key SHALL produce "no
explicit placement" (the same outcome as omitting `nulls` in a fresh
declaration), never a decode error. `formatVersion` SHALL stay 8: adding
an optional key to an existing encoded shape is the same additive-compact
move column-level `generated`/identity fields and a view body's `distinct`
already made under this version, not a version bump.

#### Scenario: An explicit nulls placement round-trips
- **WHEN** an order term declaring `desc(column, { nulls: "last" })` is
  snapshotted and read back
- **THEN** the diff against the unchanged declaration is empty, and the
  encoded order term carries a `nulls` key

#### Scenario: No explicit placement stays absent, not null
- **WHEN** an order term with no explicit `nulls` placement is snapshotted
- **THEN** the encoded order term carries no `nulls` key at all

#### Scenario: A released snapshot with no nulls key decodes unchanged
- **WHEN** a snapshot written before `nulls` existed (no `nulls` key on
  any encoded order term) is read by a build that supports it
- **THEN** it decodes to "no explicit placement" for every such term,
  `formatVersion` stays 8, and no decode error is raised

### Requirement: Stored query-node decode strictness follows the node's format provenance
The snapshot codec SHALL decide decode strictness per stored node by its
format provenance, not by a single global policy. A node kind introduced
within the current format version (the `window` node and the `with`
node) SHALL be decoded strictly: a stored node of that kind missing a
required field (a window node's function call; a `with` node's body or
entry list) is corruption, and decoding SHALL fail naming it rather than
repairing it into a plausible value — a repaired snapshot is a silently
different declaration. A node kind whose absence of a field can be an
older shape genuinely written by an earlier release (the set-operation
node) SHALL be decoded leniently: absence is read as history, not as
invalid input.

Lenient decoding is what puts a decoded snapshot outside the reach of
query-builder's construction-time key-order guard; the backstop for a
hand-edited snapshot is `hejbro verify`, which hashes the
parsed-and-re-rendered snapshot against its recorded value and reports a
reordered set-operation branch as a mismatch when the user runs that
command.

#### Scenario: A damaged window node is refused, not repaired
- **WHEN** a stored window node has no function call
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described

#### Scenario: A damaged with node is refused, not repaired
- **WHEN** a stored `with` node has no body
- **THEN** decoding fails, naming the corruption, rather than producing a
  declaration the snapshot never described

#### Scenario: A stored set-operation node decodes leniently, and verify is the backstop
- **WHEN** a hand-edited snapshot reorders a stored set-operation
  branch's projection and the snapshot is decoded
- **THEN** decoding succeeds (absence and reordering are not decode
  errors for this node kind), and `hejbro verify` reports the edit as a
  hash mismatch when run

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
