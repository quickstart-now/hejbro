# Proposal: harden-verify-and-dsl (#677)

## Why

Four defects the D106 reviews surfaced sit on shipped surfaces and have no
active change that owns them:

- `hejbro verify` reports `chain-tip-mismatch` without naming which
  migration file's `snapshot:` line and which snapshot path disagree — the
  message's identity slot reads the banner prefix, so a user with a long
  chain has nothing to open (#632).
- Core refuses a synthesized (authority `usage`) function declaration
  reaching `generate` with `synced-function-declared`, and no spec, no
  diagnostic entry names it — a D87 gap (#658, function half).
- `.references(() => target.column)` is folded inside `table()`, so two
  declaration files that reference each other crash on load with
  `Cannot read properties of undefined` regardless of load order — the
  thunk the DSL documents as deferred is not (#669). A hand-written
  brownfield schema hits this the moment two schemas point at each other.
- `ctx.return(insert(p).values(r).returning({ id: p.id }))` does not
  compile although the body requirement says `ctx.return` accepts any query
  ending in `.returning()` and the projected form is the canonical one
  (#634).

## What Changes

- `verify`'s `chain-tip-mismatch` names the migration file whose
  `snapshot:` hash is the chain tip and the snapshot path it disagrees
  with; the observation stays an observation (no cause is asserted).
- The `function-declaration` spec states that a synthesized function
  declaration reaching `generate` is refused with
  `synced-function-declared`, mirroring the table guard; the refusal
  gains a documented entry in `skills/hejbro/references/polyrepo.md`
  (`check:diagnostic-xref` itself reads no documentation — it only
  cross-references `error[<code>]` string literals inside `src` against
  each code's own `src` definition — so this is a skill-doc addition,
  not something that gate looks at).
- `.references()` thunks never resolve while `table()` runs — each is
  resolved exactly once, on the declaration's first `foreignKeys` read,
  after every declaration module has evaluated, so a cycle between
  declaration files (or two tables in one file) loads under either
  order; a self-reference keeps working unchanged. The single-evaluation
  property is kept (memoized after the first read, not re-folded on
  every later one).
- `ReturnableQuery` accepts the three mutation stages with a returning
  projection; the rendered body is measured for the projected form.
- One `patch` changeset; skill references updated where they describe
  `verify`'s message, `.references()` across files, or `ctx.return`.

## Capabilities

- `cli-commands` — MODIFIED: the verifiable-chain requirement gains a
  scenario naming the artifact a mismatch points at.
- `function-declaration` — ADDED: a synthesized declaration is refused by
  `generate`.
- `table-declaration` — MODIFIED: column-level references resolve on
  the declaration's first consumption; cross-file or same-file cycles
  load.
- `plpgsql-function-bodies` — ADDED: a projected returning is a returnable
  query.

## Impact

- Group 1: `packages/cli/src/commands/verify.ts` and its test, one sentence in
  `skills/hejbro/references/polyrepo.md`; core untouched (the tip comes from the
  CLI's own chain entries), and no diagnostic catalog exists to update.
- Group 2: `packages/core/src/dsl/table.ts`, `packages/core/src/plpgsql/body-context.ts`,
  `packages/cli/src/declare-emit/emit.ts` (comment only); new tests
  `packages/cli/test/loader-cycle.test.ts` and
  `packages/core/test/dsl/references-fold.test.ts`; two existing tests
  (`packages/core/test/dsl/cte-column-ref.test.ts`,
  `packages/core/test/query/with.test.ts`) whose assertion point moved
  with the fold. The CLI loader is untouched — the fold moved to the
  declaration's own memoized getter, not a loader collection step.
- Closes #632, #658 (function half), #669, #634.
