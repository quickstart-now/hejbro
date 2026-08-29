# Delta: snapshot-format

## Purpose

`OrderByTerm` gained an optional `nulls` placement (harden-query-surface
#470). It is a released shape (present at the `@hejbro/core@0.1.1` tag),
so the addition must follow the compact-snapshot convention: a snapshot
a released version wrote, with no `nulls` key at all, must still decode
exactly as it did before.

## ADDED Requirements

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
