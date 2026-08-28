# Tasks: scalar-function-returns

One group: the return kind has to reach the recorder before any of the
checks can exist, and the tree cannot be left half-threaded between
tasks. Estimates are pure work minutes (D88).

## 1. The declaration decides the return shape

- [x] 1.1 (~8m) [design] `returnExpr` body statement + `ReturnKind`
      threaded through `createRecordingContext`/`recordBodyWithGuard`
      into both callers. The [design] part is where the decision lives:
      on the *declaration* (`returns.returnsKind`), not on the value,
      because that is where plpgsql itself puts it — dispatching on the
      value is what let `return query` into a scalar function. Red:
      `packages/core/test/define-function.test.ts` — "returns a scalar
      expression". Files: `packages/core/src/plpgsql/body-ast.ts`,
      `plpgsql/body-context.ts`, `plpgsql/render-body.ts`,
      `dsl/define-function.ts`, `dsl/define-trigger.ts`, that test.
- [x] 1.2 (~7m) The three rejections, each asserted by `code` (the
      stable contract) rather than prose:
      `scalar-return-expects-expression`,
      `scalar-return-in-non-scalar-function`, `scalar-return-missing`.
      Red: same test file. Files: `plpgsql/body-context.ts`, that test.
- [x] 1.3 (~6m) The two `db.fn` fixtures whose empty scalar bodies are
      now refused get real bodies (this is the change working, not
      collateral: the fixture's own comment claimed a scalar body had
      nothing to return). Files:
      `packages/query/test/db/fn.test.ts`,
      `packages/query/test/db/fn-types.test.ts`.
- [x] 1.4 (~6m) `function-builder-pitfalls.md`: the `ctx.return` line
      becomes the three-form table plus a compiling scalar example. The
      snippet harness refused a `no-check` exclusion by design, so the
      example is real code. Changeset (D59, `patch`), task times, README
      badges. Files: that reference, `.changeset/*.md`,
      `openspec/task-times.csv`, `README.md`.

## Verification

- `pnpm check` clean · `pnpm check-types` 13/13 · `pnpm test` 14/14 ·
  `pnpm check:crap` 0 of 1313 over CRAP 5.
- Red first, 6 failing tests before the implementation; the two rejection
  paths that were previously *silent* are the two that matter.
