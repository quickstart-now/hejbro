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
  **existing** table node (schema, name, columns — the shape it was
  declared with — and an `existing` marker), and the generator emits
  nothing for it and diffs nothing against it. Adding, changing, or
  removing an existing declaration produces no migration. The
  vocabulary is `existing`, not `unmanaged`, because `check`'s shipped
  inventory already spends that word on a table *no declaration
  covers*, and the DSL (`existingTable`) and the core declaration field
  (`TableDeclaration.existing`) already carry this one.
- `generate --export` carries existing tables the way it carries
  managed ones (export name, column keys, numeric modes, element
  nullability), marked existing.
- The vendored contract emits an existing table under `Tables` with the
  same `Row`/`Insert`/`Update` derivation, marked in its client metadata,
  so the name-keyed client can read it and join it. Relations onto an
  existing table resolve: a managed table's foreign key to
  `auth.users` becomes a real relation once `auth.users` is declared
  with `existingTable()` (the polyrepo requirement "a reference to a
  table the schema does not own has no relation" keeps holding for
  tables not declared at all).
- `hejbro check` compares nothing about an existing table and does not
  list it as an unmanaged inventory item: it is declared, and the
  declaration claims a shape hejbro does not own. Comparing that claimed
  shape against the catalog is a separate feature (out of scope, below).
- `hejbro baseline`/`raise`/`reset` ignore existing tables (nothing to
  register, raise, or drop).
- One `minor` changeset.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `table-declaration` — ADDED "An existing table is declared for its
  shape, never for its DDL": the loader accepts it, the snapshot records
  it, the generator emits nothing.
- `schema-export` — ADDED "The export carries existing tables as such".
- `schema-vendoring` — ADDED "An existing table crosses the boundary":
  the contract's `Tables` entry, the client's read/join surface, and
  relations onto it.
- `cli-commands` — ADDED "check leaves existing declarations alone":
  no comparison, no inventory line.

## Impact

- `packages/core`: `dsl/existing-table.ts` (unchanged surface),
  `engine/generate.ts` (accept instead of refuse; skip emit/diff),
  `kinds/table-snapshot.ts` (an `existing?: true` marker, compact
  snapshot rule), `snapshot/*` (build/parse), tests.
- `packages/cli`: `loader.ts`, `export/description.ts` (+ marker),
  `contract/tables.ts`/`emit.ts`, `check/compare.ts`/`inventory.ts`,
  `commands/{reset,raise}` (skip), tests, the two-repository witness.
- `packages/query`: `client/synthesize.ts` (marker), relations.
- `packages/supabase`/`packages/nile`: `authUsers` becomes exportable as
  a declaration; the presets' validators exempt existing declarations
  explicitly — the exemption used to rest on the retired refusal making
  them unreachable.
- Snapshot format: an optional field; older readers ignore it (D33
  compact rule). Export/description format: additive fields, same
  version.

## Out of scope

- Comparing an existing declaration's claimed shape against the live
  catalog (`check`), and refusing a declaration whose shape disagrees.
- Existing objects other than tables (views, functions, enums the
  repository does not own).
- Any migration for an existing table — by definition.
