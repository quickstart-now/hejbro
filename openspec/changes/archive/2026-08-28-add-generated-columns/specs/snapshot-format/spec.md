# snapshot-format (delta)

## ADDED Requirements

### Requirement: Snapshot format version 6 records the generated family
Snapshot files SHALL carry `formatVersion: 6`. A column snapshot SHALL
record a stored generated column's expression (as the encoded
expression fragment) and an identity column's kind and any explicit
sequence options, as optional fields absent on ordinary columns — the
compact-snapshot convention. A hejbro that reads snapshots of an older
format than its own SHALL regenerate them on the next generate without
changing any migration file; a hejbro older than the snapshot it reads
SHALL fail with the existing newer-format diagnostic rather than
silently ignoring fields it does not know.

#### Scenario: The generated family survives a snapshot round-trip
- **WHEN** a table declaring generated and identity columns is
  snapshotted and the snapshot is read back
- **THEN** the diff against the unchanged declarations is empty — the
  expression text, identity kind, and explicit options all round-trip

#### Scenario: An older reader refuses a version-6 snapshot loudly
- **WHEN** a hejbro whose snapshot format is older than 6 reads a
  version-6 snapshot
- **THEN** it fails with the newer-format diagnostic naming the
  version mismatch, never a diff computed with the new fields ignored
