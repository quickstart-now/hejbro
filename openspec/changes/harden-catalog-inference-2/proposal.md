# Proposal: harden-catalog-inference-2 (#678, #712)

## Why

Two gaps in the catalog reading, both found by the D106 rounds of
`add-catalog-inference` and left for the 0.2.x line.

1. **A role named only by a policy is not inferred (#678).** The reading
   unions the roles named in table grants, schema-usage grants and
   default table grants; its policies query reads `schemaname,
   tablename, policyname` and never `pg_policies.roles`. A role that
   appears only in a policy's `TO <role>` reaches neither `import`'s
   description nor the pulled contract's `roles`, so `db.as` refuses it
   on the consumer's side for a role the database plainly uses.
2. **An enum type's name is the one identifier D36 never judges (#712).**
   `pgEnum` asserts nothing about its name, so `create type app."Status"`
   reaches the snapshot, the starter declarations and the emitted DDL
   unchanged, while a table, schema, index or check of the same shape is
   omitted and named in the loss report. The reading's closed omission
   list simply does not mention enums.

## What Changes

- **Roles come from grants and policies.** The policies query reads
   `pg_policies.roles`; those names join the inferred role set; `public`
   — the catalog's spelling of "unrestricted" — is not a role and is not
   reported.
- **An enum type's name is held to D36 like every other identifier.**
   An enum whose catalog name no declaration can carry is omitted and
   named in the loss report, together with every column typed by it —
   the column loses its type, so it is omitted with it and named — and
   the report's line says what `check` will do about the enum
   afterwards, exactly as the other omission lines do.
- The catalog-inference reference's loss list gains the enum line; one
  `patch` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`catalog-inference`** — MODIFIED requirements: *A catalog reading
  yields a snapshot and a marked description* (roles from policies too;
  enum names in the omission class) and *The loss is announced, with the
  way out* (the omitted-enum line).

## Impact

- `hejbro` (CLI): `check/catalog.ts` (the policies query), `infer/
  rest.ts` (`inferRoleNames`, the enum reading), `infer/compose.ts`
  (omission), `infer/loss-report.ts`; their tests and the Docker-gated
  witness.
- `skills/hejbro`: `references/brownfield-adoption.md` (the loss list).
