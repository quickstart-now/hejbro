# Design: harden-adoption

Settled by the lead under the owner's full delegation for this pass;
recorded as rulings on the change's issues.

## Q1 — The table's children on adoption (#671)

- (a) Emit the additive table-level objects the managed declaration
  adds (indexes, checks, foreign keys, primary key); a conflict fails
  loudly at apply.
- (b) Keep the table node silent and say so.
- **Ruling (a).** J10 already decided the shape for sequences, RLS and
  policies: adoption means "hejbro manages this now", and a declaration
  the snapshot records as managed must be what the database holds.
  Silence-forever is the failure the owner's detect-and-name rule
  forbids. Drops are never emitted on adoption (a column or index the
  database has and the declaration lacks is `check`'s inventory, not
  adoption's business).

## Q2 — The leftover sequence (#694)

- A: `create sequence if not exists` everywhere.
- C: idempotent create plus unconditional `alter sequence` to the
  declared attributes, on adoption only.
- **Ruling C, scoped by the transition.** The diff engine already knows
  the owner's transition (`ownerIsExisting` reads the authoritative
  owner node); it hands the sequence kind a "create for an adopted
  owner" change so the emitter renders the idempotent form and the
  alters there, and the plain `create sequence` everywhere else — a
  greenfield collision still fails loudly. The silent-mismatch window A
  would have opened is closed by the alters.

## Q3 — The diagnostic (#668)

`adoption-creates`, printed by `generate` once per adopted table,
listing the objects the migration will create for it and ending with
`Next:` naming `hejbro baseline` for a database that already holds
them. A warning, not a refusal: the migration is written. Handover
prints nothing (nothing is created). Covered by `check:diagnostic-xref`
like every code.
