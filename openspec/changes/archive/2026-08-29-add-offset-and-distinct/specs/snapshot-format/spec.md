# snapshot-format (delta)

## MODIFIED Requirements

### Requirement: Snapshot format version 8 records a view body's offset and distinct
Snapshot files SHALL carry `formatVersion: 8`. A column snapshot SHALL
record a stored generated column's expression (as the encoded expression
fragment) and an identity column's kind and any explicit sequence options,
as optional fields absent on ordinary columns — the compact-snapshot
convention. A table snapshot's foreign keys SHALL be recorded in the
canonical declaration-form-independent order (local columns, then target
identity), so the bytes never depend on WHICH declaration form wrote an
edge. A serialized select — a view's body — SHALL record its `offset` and
its `distinct` clause, `distinct` as `null` when absent rather than an
always-present wrapper. A hejbro older than the snapshot it reads SHALL
fail with the existing newer-format diagnostic; a hejbro newer than the
snapshot it reads SHALL fail with the existing older-format diagnostic and
its pin-or-reset guidance rather than silently ignoring or misreading
fields.

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
