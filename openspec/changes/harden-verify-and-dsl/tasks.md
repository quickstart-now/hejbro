# Tasks: harden-verify-and-dsl

Two file-disjoint groups; each is one team piece. Estimates are pure work
minutes; every task starts from its named red test. Verification (gates,
`openspec validate --strict`, `show --diff`) is the definition of done.

## 1. Verify identity and the synced-function spec (#677)

- [x] 1.1 (~7m) `[design]` `chain-tip-mismatch` names the migration file
      and the snapshot path (#632). Red: `packages/cli/test/verify.test.ts`
      — "a tip mismatch names the last migration and the snapshot path"
      (the golden pins the new text; the message stays an observation,
      no cause). Green: `packages/cli/src/commands/verify.ts` builds the
      message from the tip file name and `snapshotPath`. Design detail:
      exact wording (owner-approved verbatim texts live here — keep the
      sentence shape, add the two names).
      Files: `packages/cli/src/commands/verify.ts`, test, skill sentence
      if a reference quotes the message.
- [x] 1.2 (~6m) `synced-function-declared` is specified and documented
      (#658, function half). Red: `packages/core/test/engine/function-authority-refusal.test.ts`
      already exists — add the assertion that the message names the
      function and the way forward (delta scenario). Premise corrected
      by measurement (#677 implementer, HV-G1-R1-01): `check:diagnostic-xref`
      reads no documentation at all — it only cross-references `error[<code>]`
      string literals inside `src` against each code's own `src`
      definition, and the repository carries no diagnostics-list doc for
      it to check against. `synced-table-declared`'s own half (the table
      cousin of this refusal) is not documented anywhere in `skills/` or
      `docs/` either, and stays `add-unmanaged-objects` round 4's to add —
      no note to leave inside a nonexistent list.
      Files: core error text (unchanged — already names the function),
      `skills/hejbro/references/polyrepo.md`, test.

## 2. DSL: cross-file references and projected returning (#677)

- [x] 2.1 (~10m) `[design]` `.references()` thunks resolve at collection
      time (#669). Red: `packages/cli/test/loader-cycle.test.ts` — two
      schema files referencing each other, loaded under both name orders
      through the real loader (`collectDeclarations`), currently
      `Cannot read properties of undefined`. Green: `foldColumnReferences`
      moves out of `table()` into a collection-time fold (once per
      declaration; `table()` keeps the column state, the loader — or the
      core `collectDeclarations` if that is where every module is known —
      folds). Self-reference and the existing `references.test.ts` stay
      green; the "duplicate declaration over one column" error keeps
      firing at the same point or the delta says where it moved. Design
      detail: where the fold lives (core vs loader) — measure who has
      every module first; keep core pure.
      Files: `packages/core/src/dsl/table.ts`, `packages/cli/src/loader.ts`
      (or core collection), tests, `skills/hejbro` sentence on cross-file
      references.
- [x] 2.2 (~7m) `ctx.return` accepts a projected returning (#634). Red:
      `packages/core/test/plpgsql/render-body.test.ts` — "returns a
      projected returning" (currently a type error / refusal). Green:
      widen `ReturnableQuery`'s three mutation members to the
      `…Final<Table, ReturningProjection | undefined>` shape and measure
      the rendered `RETURNING` list. Close: `.changeset/harden-verify-and-dsl.md`
      (`patch`), skill sentence.
      Files: `packages/core/src/plpgsql/body-context.ts`, tests, changeset,
      skill.

Group close (each): gates as CI runs them, `pnpm build --force` before cli
subprocess suites, `openspec validate --strict`, `show --diff` 0 warnings
with MODIFIED requirements classified MODIFIED. Ledger rows and README
badges are the lead's PR-time commit.
