# Proposal: harden-vendor-name-collision (#1004)

## Why

The vendored contract keys `Database.Tables` and
`contractMetadata.tables` by the table's SQL name alone. Two carried
tables that share a name across schemas — the usual Supabase layout,
an `existingTable("auth", "users")` beside a managed `app.users`, or
`a.widgets` beside `b.widgets` — make `hejbro vendor` emit the key
twice: the contract does not compile (TS2300 ×2, TS2717, TS1117), at
run time the last literal wins so `client.users` is `app.users` and
`auth.users` is reachable through no member, and a relation whose
target names the twice-emitted key throws `unknown-relation` although
the contract text names it. Measured twice (constructor review of
`add-vendored-related`, N2; its D106 round 1, B1), reproduced on the
pre-`Relations` CLI: the root predates the relations work. The failure
is loud, but on the wrong artifact and in the wrong repository — the
consumer's `tsc`, after the files were written.

`add-vendored-related` archived with its requirement scoped to a table
whose name is unique among the carried tables and named the pair as
"the emitter's unresolved collision" (653/R8). The issue's verdict
(412/D29) is to refuse at emission with a coded diagnostic; qualifying
the keys is a separate, larger decision and is not this change.

## What Changes

- **A contract with two carried tables of one SQL name is never
  written.** The shared emitter refuses before any file is produced;
  the collision is detected on the exact SQL name across different
  schemas (`Users` and `users` are two names), and the diagnostic
  names every colliding name with each of its qualified tables, in
  identity order. Functions are untouched (keyed by export name; *Every
  emitted key compiles* already owns them).
- **One code per command, because the remedies differ** (1004/R1):
  `vendor-table-name-collision` says the schema filter is reserved on
  `vendor` and the export itself must carry one table per SQL name —
  the declaring repository's to fix; `pull-table-name-collision` says
  to drop one of the schemas from `--schema`. Nothing is written by
  either command on refusal.
- **The spec stops calling the pair an unresolved collision.** *An
  existing table crosses the boundary* now points at the refusal; the
  refusal is its own requirement, scoped to emission (shared with
  `pull`), explicitly outside the eleven-situation enumeration that
  covers obtaining and checking a vendored schema.
- `polyrepo.md`'s keying paragraph states the rule and the refusal; one
  `patch` changeset (`hejbro`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`schema-vendoring`** — ADDED requirement: *Two carried tables with
  one SQL name are refused at emission*. MODIFIED requirement: *An
  existing table crosses the boundary* (the collision sentence now
  points at the refusal; scenarios unchanged).

## Impact

- `hejbro` (`packages/cli`): `src/contract/name-collision.ts` (new: the
  guard and both messages), `src/contract/emit.ts` (calls it once, after
  the tables are computed), `test/contract-name-collision.test.ts`
  (new), `test/vendor.test.ts` (one CLI case: exit 1, the code on
  stderr, nothing written).
- `skills/hejbro/references/polyrepo.md` (keying paragraph).
- No `@hejbro/core`, `@hejbro/query` or preset change; no snapshot or
  export format change.
