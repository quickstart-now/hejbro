# Design: add-references-actions

Settled by the lead under the owner's full delegation for this pass;
recorded as a ruling on the change's issue.

## Q1 — Where the actions go

- (i) A second argument: `.references(() => users.id, { onDelete:
  "cascade" })`.
- (ii) Chained methods: `.references(...).onDelete("cascade")`.
- **Ruling (i).** One call, one declaration, mirroring the `extras`
  object's own keys; a chained method would let `.onDelete()` appear on
  a column with no reference, which then needs its own refusal. Both
  keys optional; the vocabulary is `foreignKeyActions`, exported already.

## Q2 — Parity is the contract

The fold produces the same `ForeignKeyDeclaration` the `extras` form
does, actions included, so every downstream surface (DDL, snapshot,
canonical order, diff, rename retargeting) sees one shape. The
scenario's input table spans the action vocabulary on both keys, in
both forms, and asserts identical DDL and snapshot text.

## Q3 — The example

Converting `examples/postgres`'s foreign keys is the honest witness:
the committed snapshot and migration chain are pinned by hashes, so a
conversion that changed a byte would fail `verify`; the round trip
proves the generated SQL on a live server. Foreign keys that are
composite or self-referencing stay on `extras`, and the example keeps
one of each form if it has them.

## Q4 — The decision log

D102's row says actions stay on the `extras` path; this change amends
that sentence (lead, under delegation; surfaced on return). Nothing else
in the row moves.
