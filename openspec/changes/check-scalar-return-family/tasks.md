# Tasks — check-scalar-return-family

Lead-direct piece (single group; #478 is the tracking issue, already In
Progress). Verification is the definition of done for every task: the
full gates (`pnpm check`, `check-types`, `test` under `TURBO_FORCE=1`)
plus `openspec validate check-scalar-return-family --strict`.

## 1. Family cross-check

- [ ] 1.1 [design] Refusal table module + threading + diagnostic (~10m)
  - Settles: the diagnostic's exact message/`Next:` text; the threading
    shape (fourth `scalarReturnFamily: SqlTypeFamily | null` parameter
    on `recordBodyWithGuard`/`createRecordingContext` per design.md
    decision 1).
  - Red: `packages/core/test/plpgsql/return-family.test.ts` · "a uuid
    expression returned as integer fails with
    scalar-return-family-mismatch" — red today because
    `recordReturnExpr` pushes the statement with no family comparison.
    What breaks it red after landing: deleting the `uuid` entry from the
    numeric row of the refusal table, or removing the
    `isRefusedReturnFamily` call from `recordReturnExpr`.
  - Files: `packages/core/src/plpgsql/return-family.ts` (new),
    `packages/core/src/plpgsql/body-context.ts`,
    `packages/core/src/dsl/define-function.ts`,
    `packages/core/src/dsl/define-trigger.ts`,
    `packages/core/test/plpgsql/return-family.test.ts` (new).
- [ ] 1.2 Acceptance boundaries + table pins (~8m)
  - Red: `return-family.test.ts` · "a numeric expression returned as a
    datetime is accepted" (value-dependent pair), plus cases: sql
    fragment (unknown) never refused; same-family accepted; text- and
    bytea-family `returns` accept every family; refusal-table pin — the
    table holds exactly the 49 measured pairs (inline literal count +
    spot pairs both ways). What breaks each red: adding datetime to the
    numeric row / adding any entry to the text row / editing the table.
  - Files: `packages/core/test/plpgsql/return-family.test.ts`.
- [ ] 1.3 Diagnostic docs + changeset (~5m)
  - Red: `packages/skills/test/links.test.ts` stays green while the
    skill's diagnostics reference gains the new code (if the reference
    lists `scalar-return-*` codes — check and mirror the fn precedent);
    `pnpm changeset` (patch).
  - Files: `skills/hejbro/references/*` (only if diagnostics are
    listed there), `.changeset/*.md` (new).
