## MODIFIED Requirements

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
SHALL fail with the older-format diagnostic rather than silently
ignoring or misreading fields — naming the upgrade command as the next
step when the snapshot's format is one a released hejbro wrote (format
5 or later), and giving the pin-or-reset guidance when the format is
older than any release.

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
- **WHEN** this build reads a version-7 snapshot through any command
  other than the upgrade
- **THEN** it fails with the older-format diagnostic naming the version
  mismatch and ending with the upgrade command as the next step, never
  a mis-diff over the missing clauses

#### Scenario: A format no release wrote keeps the pin-or-reset guidance
- **WHEN** this build reads a snapshot whose format is below 5, or one
  carrying the pre-`formatVersion` key
- **THEN** it fails with the older-format diagnostic and its pin-or-reset
  guidance, and the upgrade command is not offered

## ADDED Requirements

### Requirement: An older released format is re-encoded into the current format
The core SHALL expose a pure re-encoding of a snapshot text whose format
is one a released hejbro wrote — format 5 or later, up to the current
format — into the current format: the text is read under the current
decoder's rules, where a field the older shape does not carry decodes to
its empty value, brought to the canonical form, and rendered as the
current writer renders. The re-encoding SHALL be idempotent, SHALL be
the identity on a current-format snapshot, SHALL keep every object with
its kind and identity, and SHALL refuse a format older than any release
and a format newer than the current one with the same diagnostics the
ordinary read gives. Where a format change was neither additive nor a
canonicalization, the re-encoding carries that change's own step; a
field the current shape requires that no rule can derive from the older
shape is a refusal naming the field, never a guessed value.

#### Scenario: A released format-5 snapshot re-encodes to the current format
- **WHEN** each format-5 snapshot the first release wrote — its two
  example snapshots and its golden-case snapshots — is re-encoded
- **THEN** every result carries `formatVersion: 8`, keeps every object
  key and kind, and re-encoding a result again yields the same bytes

#### Scenario: A golden case with unchanged declarations reproduces the writer's bytes
- **WHEN** a golden case whose declarations are unchanged since the
  first release has its format-5 expected snapshot re-encoded
- **THEN** the result equals the current expected snapshot byte for byte

#### Scenario: The current format is a fixed point
- **WHEN** a current-format snapshot as the current writer renders it --
  in canonical form -- is re-encoded
- **THEN** the result is byte-identical to the input; a same-format
  file an earlier writer rendered in a different canonical order (a
  pre-release writer's `checks` order, measured) is re-encoded to the
  current canonical form instead, and `hejbro upgrade` still treats a
  format match as a no-op (tracked separately)

#### Scenario: Formats outside the released range are refused
- **WHEN** a format-4 snapshot, one carrying the pre-`formatVersion`
  key, and a format-9 snapshot are each re-encoded
- **THEN** each is refused with the diagnostic the ordinary read gives
  for it, and nothing is rendered
