# Proposal: add-unmanaged-objects (#605)

## Why

An application often joins a table it does not own — Supabase's
`auth.users`, Nile's built-ins, a legacy table another team manages.
hejbro has a reference-only primitive for that, `existingTable()` (D41):
usable as a foreign-key target, in `exists()`, in view bodies and joins,
never diffed or emitted. But it lives only in the declaring process: it
is not in the snapshot, so the export does not carry it, the vendored
contract does not know it, and a consuming repository has nothing to
join against. The polyrepo change recorded this as its fourth gap:
"what is needed is a declaration that produces **no migration** but
does produce types and metadata". `existingTable` produces the types;
this change makes it produce the metadata, everywhere the managed
tables' metadata goes.

## What Changes

- An `existingTable()` exported from a schema file is a valid
  declaration: the loader accepts it, the snapshot records it as an
  **unmanaged** table node (schema, name, columns — the shape it was
  declared with — and an `unmanaged` marker), and the generator emits
  nothing for it and diffs nothing against it. Adding, changing, or
  removing an unmanaged declaration produces no migration.
- `generate --export` carries unmanaged tables the way it carries
  managed ones (export name, column keys, numeric modes, element
  nullability), marked unmanaged.
- The vendored contract emits an unmanaged table under `Tables` with the
  same `Row`/`Insert`/`Update` derivation, marked in its client metadata,
  so the name-keyed client can read it and join it. Relations onto an
  unmanaged table resolve: a managed table's foreign key to
  `auth.users` becomes a real relation once `auth.users` is declared
  unmanaged (the polyrepo requirement "a reference to a table the
  schema does not own has no relation" keeps holding for tables not
  declared at all).
- `hejbro check` compares nothing about an unmanaged table and does not
  list it as an unmanaged inventory item: it is declared, and the
  declaration claims a shape hejbro does not own. Comparing that claimed
  shape against the catalog is a separate feature (out of scope, below).
- `hejbro baseline`/`raise`/`reset` ignore unmanaged tables (nothing to
  register, raise, or drop).
- One `minor` changeset.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `table-declaration` — ADDED "An unmanaged table is declared for its
  shape, never for its DDL": the loader accepts it, the snapshot records
  it, the generator emits nothing.
- `schema-export` — ADDED "The export carries unmanaged tables as such".
- `schema-vendoring` — ADDED "An unmanaged table crosses the boundary":
  the contract's `Tables` entry, the client's read/join surface, and
  relations onto it.
- `cli-commands` — ADDED "check leaves unmanaged declarations alone":
  no comparison, no inventory line.

## Impact

- `packages/core`: `dsl/existing-table.ts` (unchanged surface),
  `engine/generate.ts` (accept instead of refuse; skip emit/diff),
  `kinds/table-snapshot.ts` (an `unmanaged?: true` marker, compact
  snapshot rule), `snapshot/*` (build/parse), tests.
- `packages/cli`: `loader.ts`, `export/description.ts` (+ marker),
  `contract/tables.ts`/`emit.ts`, `check/compare.ts`/`inventory.ts`,
  `commands/{reset,raise}` (skip), tests, the two-repository witness.
- `packages/query`: `client/synthesize.ts` (marker), relations.
- `packages/supabase`: `authUsers` becomes exportable as a declaration
  (no change to the preset's reserved-schema validator — it exempts
  existing tables already).
- Snapshot format: an optional field; older readers ignore it (D33
  compact rule). Export/description format: additive fields, same
  version.

## Out of scope

- Comparing an unmanaged declaration's claimed shape against the live
  catalog (`check`), and refusing a declaration whose shape disagrees.
- Unmanaged objects other than tables (views, functions, enums the
  repository does not own).
- Any migration for an unmanaged table — by definition.
