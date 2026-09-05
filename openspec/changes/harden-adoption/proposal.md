# Proposal: harden-adoption (#668, #671, #694)

## Why

Adopting a table — replacing `existingTable()` with a managed `table()`
— creates the objects hejbro manages beside the table (sequences,
row-level security, policies) and never the table itself. Three
consequences were measured and left open:

1. **The table's own children are never created (#671).** A declared
   index, check, foreign key or primary key lives inside the table node,
   and the table node is silent in both directions on adoption; adopting
   `widgets` with a declared `widgets_email_idx` emits no `create index`,
   and since the next snapshot records the table as managed with that
   index, no later run creates it either. Silence forever, the trap J10
   closed for row-level security.
2. **Handover then adoption fails on a sequence that already exists
   (#694).** Handover keeps the sequence by design; adopting the table
   back renders the brand-new-table path (`create sequence …`), and the
   server answers `42P07`.
3. **Nothing says so before apply (#668).** Loud failure at apply time is
   the intended mode, but no generate-time diagnostic tells the user
   that adoption will try to create objects the database may already
   hold, or points at `baseline`.

## What Changes

- **Adoption creates the table's additive children.** On an
  existing→managed transition the declaration's indexes, checks, foreign
  keys and primary key are emitted as creates, as the objects beside the
  table already are; a conflict with what the database holds fails
  loudly at apply time, consistent with the sequences and policies.
  Handover stays silent in every direction.
- **An adopted table's sequences are created idempotently and brought
  to their declared attributes.** The sequence emitter learns the
  owning table's transition: for an adopted owner it renders `create
  sequence if not exists` followed by the `alter sequence` statements
  that set the declared type and ownership, so a sequence a handover
  left behind is reused and normalized rather than refused. A greenfield
  table keeps the plain `create sequence`, so a genuine name collision
  there still fails loudly.
- **`generate` names what adoption will create.** When a table changes
  hands to managed, the run prints `adoption-creates`, naming the
  objects it will create for that table (sequences, RLS, policies,
  indexes, checks, foreign keys, primary key) and the `baseline` path
  for a database that already holds them. A handover prints nothing.
- The brownfield reference states the adoption contract; one `minor`
  changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`table-declaration`** — MODIFIED requirement: *An existing table is
  declared for its shape, never for its DDL* (the adoption paragraph
  and its scenario cover the table's children and the idempotent
  sequence).
- **`cli-commands`** — ADDED requirement: *generate names what an
  adoption will create*.

## Impact

- `@hejbro/core`: `engine/diff-engine.ts` (the adoption transition
  reaches the table kind's and the sequence kind's emit), `kinds/
  table-kind*.ts`, `kinds/sequence-kind.ts`, goldens.
- `hejbro` (CLI): `commands/generate.ts` (the diagnostic).
- `skills/hejbro`: `references/brownfield-adoption.md`.
