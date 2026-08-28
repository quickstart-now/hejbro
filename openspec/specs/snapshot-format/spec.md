# snapshot-format Specification

## Purpose

The on-disk snapshot files hejbro writes next to generated migrations:
their format version and what a column snapshot records, so that
diffing against an unchanged declaration is exact and version skew
fails loudly instead of silently.

## Requirements

### Requirement: Snapshot format version 7 records the generated family and canonical foreign-key order
Snapshot files SHALL carry `formatVersion: 7`. A column snapshot SHALL
record a stored generated column's expression (as the encoded
expression fragment) and an identity column's kind and any explicit
sequence options, as optional fields absent on ordinary columns — the
compact-snapshot convention. A table snapshot's foreign keys SHALL be
recorded in the canonical declaration-form-independent order (local
columns, then target identity), so the bytes never depend on WHICH
declaration form wrote an edge. A hejbro older than the snapshot it
reads SHALL fail with the existing newer-format diagnostic; a hejbro
newer than the snapshot it reads SHALL fail with the existing
older-format diagnostic and its pin-or-reset guidance rather than
silently ignoring or misreading fields.

#### Scenario: The generated family survives a snapshot round-trip
- **WHEN** a table declaring generated and identity columns is
  snapshotted and the snapshot is read back
- **THEN** the diff against the unchanged declarations is empty — the
  expression text, identity kind, and explicit options all round-trip

#### Scenario: An older reader refuses a version-7 snapshot loudly
- **WHEN** a hejbro whose snapshot format is older than 7 reads a
  version-7 snapshot
- **THEN** it fails with the newer-format diagnostic naming the
  version mismatch, never a diff computed with the new ordering
  assumed

#### Scenario: A version-6 snapshot is refused as older, loudly
- **WHEN** this build reads a version-6 snapshot
- **THEN** it fails with the older-format diagnostic and its
  pin-or-reset guidance, never a mis-diff over the uncanonical order
