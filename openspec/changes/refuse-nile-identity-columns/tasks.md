# Tasks: refuse-nile-identity-columns (#573)

Lead-direct piece (single package + one delta). Base: dev `83a2e084`.
Estimates at agent scale (recent measured 3–10 min per group).

## 1. The identity validator and its records (#573)
Files: `packages/nile/src/validators.ts`, `packages/nile/src/preset.ts`
(validator list, additive), `packages/nile/test/validators.test.ts`,
`skills/hejbro/references/nile-preset.md`, `.changeset/*.md`,
`openspec/task-times.csv`

- [x] 1.1 (4m) `nileIdentityValidator`: both identity kinds on a
      tenant-aware table are refused with `nile-identity-in-tenant-table`,
      message naming the column, `MEASURED_ONLY`, and a `Next:`; registered
      in `nilePreset.validators` (5 → 6). Failing test: `validators.test.ts`
      "An identity column in a tenant-aware table is refused" (both kinds,
      one diagnostic each; the identity column outside a tenant-aware
      table passes; the refusal-list count assertion moves to 6; the
      `Next:` loop covers the new code automatically).
- [x] 1.2 (3m) Keyless tenant-aware table: the existing "never measured"
      test becomes "measured: accepted" — assertion unchanged, name and
      comment corrected. Failing test: rename-only (the assertion already
      holds); the mutant for 1.1 (remove the validator from the list) must
      turn exactly the identity tests red and nothing else.
- [x] 1.3 (3m) Skill: the refusal table gains the identity row (code,
      measured-only evidence, the verbatim server error); the two
      "unmeasured" notes (identity, keyless) are replaced with the
      measurements and their date. Failing test:
      `packages/skills/test/nile-preset-doc.test.ts` gains one token
      assertion for the identity row.
- [x] 1.4 (2m) `minor` changeset; ledger rows with `date -u` stamps.

## Verification (definition of done, not a task)
`TURBO_FORCE=1 pnpm check / check-types / test` with the `cached` count
quoted; `pnpm check:crap`; no file under
`packages/{core,query,cli,pg,supabase,neon}` in the diff.
