# Proposal: harden-catalog-inference-2 (#678, #712, #872, #873, #874)

## Why

Five gaps in the catalog reading and its loss report, found by the
D106 rounds of `add-catalog-inference` and the constructor review of
`harden-check-inventory`, left for the 0.2.x line.

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

3. **A non-default primary-key constraint name is dropped silently
   (#872).** The DSL derives every primary-key name, so `pk_orders` is
   lost with no loss-report line; after the inventory landed, `check`
   on the untouched database then reports two lines for what the user
   never chose.
4. **A foreign key to an omitted column makes the starter fail to load
   (#873).** When a column is omitted for its name, the foreign key that
   references it is still written, and the reading itself dies with an
   unhandled error from core's foreign-key resolution before any file
   is written (measured), so `import` produces neither declarations nor
   a loss report.
5. **The loss report sorts by locale (#874).** `sortedBy` uses
   `localeCompare`, so `import`/`pull` output order depends on the
   process locale and treats NFC/NFD pairs as equal — the rule `check`'s
   inventory already settled ("code points, not a collation") one
   command over.

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
- **A dropped primary-key name is announced.** A primary key whose
  catalog name is not the derived one is inferred under the derived name
  and the loss report names the constraint name it dropped, with the
  way out: rename the constraint in the database to the derived name,
  or keep it and expect `check`'s inventory to name it.
- **A foreign key touching an omitted column is omitted with it, and
  named.** Either end — a referencing or a referenced column the
  reading left out — takes the foreign key out of the declarations and
  onto the report, so the starter always loads.
- **Every list hejbro prints sorts by code points.** One shared
  comparator serves `check`'s inventory and the loss report.
- The catalog-inference reference's loss list gains the enum and the
  primary-key-name lines; one `patch` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`catalog-inference`** — MODIFIED requirements: *A catalog reading
  yields a snapshot and a marked description* (roles from policies too;
  enum names in the omission class) and *The loss is announced, with the
  way out* (the omitted-enum, dropped-primary-key-name and omitted
  foreign-key lines; code-point order).

## Impact

- `hejbro` (CLI): `check/catalog.ts` (the policies query), `infer/
  rest.ts` (`inferRoleNames`, the enum reading), `infer/compose.ts`
  (omissions), `infer/loss-report.ts` (lines; the shared comparator, in
  `check/inventory.ts`'s home or a small shared module); their tests and
  the Docker-gated witness.
- `skills/hejbro`: `references/brownfield-adoption.md` (the loss list).
