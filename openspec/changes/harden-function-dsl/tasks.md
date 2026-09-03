# Tasks: harden-function-dsl

Two file-disjoint groups, one branch, one PR. Estimates are pure work
minutes; every task starts from its named red test. Verification (gates,
`openspec validate --strict`, `show --diff`) is the definition of done,
never a task.

Shared files are single-writer by construction:
`skills/hejbro/references/function-builder-pitfalls.md` and the changeset
are written once, in 2.3, and cover both groups' refusals.

## 1. Argument names follow D36 (#679)

- [x] 1.1 (~8m) `[design]` `defineFunction` refuses an argument key whose
      derived SQL name is not a hejbro SQL name. Red:
      `packages/core/test/define-function.test.ts` — "an argument key
      whose derived name is not a hejbro SQL name is refused", an input
      table (D110: the scenario's claim is universal): `"my-arg"`,
      `"2nd"`, `"Weight"`, `"my arg"`, `'q"k'`, `"café"`,
      `{ ["__proto__"]: uuid() }` (a computed key — a plain `__proto__`
      key is the prototype setter and never an own property), `""`; plus
      the control rows `postId` → `post_id`, `delay` → `delay`, and
      `order` → still `reserved-local-name`, each asserted on `code`.
      Green: `resolveArgs` calls `assertSqlName(argName, <context>,
      declaredAt)` before `assertValidLocalName`. Design detail: the
      `context` string, which is what carries the function identity and
      the declared key into the existing sentence — proposal
      `argument "<key>" of function <schema>.<name>`, rendering
      `argument "my-arg" of function app.echo_arg name "my-arg" is not a
      valid hejbro SQL identifier — … Next: rename the argument "my-arg"
      of function app.echo_arg to snake_case.` No new wording and no
      change to `identifier-rules.ts`.
      Files: `packages/core/src/dsl/define-function.ts`,
      `packages/core/test/define-function.test.ts`.
- [x] 1.2 (~7m) The emitter's argument-key observer moves to the export
      it reads. Red: `packages/cli/test/contract-emit.test.ts` — "quotes
      a column key and an argument key that are not identifiers" throws
      `invalid-sql-name` from its own fixture after 1.1. Green: declare
      the argument as `myArg` and patch the export payload's function arg
      fact `key` to `"my-arg"`, exactly as the column half already
      patches `columns[...].key`; the emitter, its assertions and the
      `describe` block's own reasoning comment stay on the emitter axis.
      Files: `packages/cli/test/contract-emit.test.ts`.
- [x] 1.3 (~9m) The real-`tsc` observer moves the same way. Red:
      `examples/cli-smoke/test/vendored-contract.test.ts` — `generate`
      exits non-zero on `SCHEMA_SOURCE`'s `echoArg` after 1.1. Green:
      `echoArg` declares `myArg`; the hand-edited-export test
      ("a hand-edited export's non-identifier column keys compile under a
      real tsc") also patches that function fact's argument key to
      `"my-arg"` and its consumer file calls
      `client.fn.echoArg({ "my-arg": … })`, so the argument half keeps a
      real-`tsc` observer. Needs a forced rebuild first (this suite spawns
      the built CLI): `TURBO_FORCE=1 pnpm check-types`, whose `^build`
      dependency rebuilds every package.
      Files: `examples/cli-smoke/test/vendored-contract.test.ts`.
      Note (landed): the hand-edited-export schema carried no function at
      all, so the argument half had nowhere to move to — that schema
      gains an `echoArg(myArg)` declaration and the export fact's
      `args[0].key` is patched. The observer moved; it was not dropped.

## 2. ctx.return demands a returning clause (#686)

- [x] 2.1 (~10m) `[design]` A mutation stage before `.returning()` is not
      assignable to `ctx.return`. Red:
      `packages/core/test/plpgsql/body-context.test.ts` —
      `@ts-expect-error` on `ctx.return(insert(p).values(r))`,
      `ctx.return(update(p).set(r))`,
      `ctx.return(deleteFrom(p))` and
      `ctx.return(insert(p).values(r).onConflictDoNothing(p.id))`, with
      the `.returning()` / `.returning({…})` / bare-`select` /
      `ctx.execute(insert(p).values(r))` rows beside them as the controls
      that must keep compiling. Evidence is `pnpm check-types` across the
      workspace — never `vitest`, which cannot see a type claim, and
      never a `--filter`, since `@hejbro/query` constructs these stage
      types (`db/chain.ts`) and reads `TReturning` (`types/returning.ts`).
      Green (proposal): the stage brand gains a phantom stage marker —
      `InsertFinal<TTable, TReturning, TStage extends "returnable" |
      "final" = "final">`, with `InsertReturnable`/`UpdateReturnable`/
      `DeleteReturnable` instantiating `"returnable"`, so `TReturning`
      stays `never` and `@hejbro/query`'s `ReturningRow` is untouched;
      `ctx.execute` takes a stage-agnostic union (proposed name
      `ExecutableQuery`, exported from core and re-exported by `hejbro`),
      `ReturnableQuery` keeps its name and its `"final"` meaning. The
      stage parameter is defaulted, so every existing use of the public
      names (`InsertFinal<T, R>` and its twins) SHALL keep compiling
      untouched: the evidence is a workspace-wide `check-types` including
      `examples/`, and `@hejbro/query`'s existing type tests passing
      unmodified. If any of them needs an edit, report before reaching
      for the fallback. If tsc does not
      cooperate, the recorded fallback is to leave `mutate.ts` alone and
      put the exclusion in `ctx.return`'s own signature (a conditional
      intersection on a generic parameter) — report the difference
      between the probe and the codebase before proposing a third
      mechanism.
      Files: `packages/core/src/query/mutate.ts`,
      `packages/core/src/plpgsql/body-context.ts`,
      `packages/core/test/plpgsql/body-context.test.ts`.
- [x] 2.2 (~8m) `[design]` The declaration-time refusal for a caller that
      bypassed the type. Red:
      `packages/core/test/plpgsql/render-body.test.ts` — "a returned
      mutation with no returning is refused": insert, update and delete
      in a `setof`-returning declaration, each reaching `ctx.return`
      through the same type-bypassing cast the recorder's other
      bypass-only refusals use, asserted on `code`; the control rows are
      the three `.returning()` forms, which still render
      `return query …;` with their own `RETURNING` list. Green: in
      `recordReturnQueryShape`, after the scalar and trigger branches (so
      `scalar-return-expects-expression` and `trigger-return-expects-row`
      keep firing first and unchanged), refuse a mutation node whose
      `returning` is `null`. Design detail: the code name — proposal
      `return-expects-returning`, the mirror of
      `execute-expects-no-returning` under the operation-prefix rule —
      and a message naming the statement kind and both working forms.
      Keep each function's branching under the CRAP gate (extract a
      helper the way `assertExecuteHasNoReturning` was extracted).
      Files: `packages/core/src/plpgsql/body-context.ts`,
      `packages/core/test/plpgsql/render-body.test.ts`.
- [x] 2.3 (~6m) Both refusals reach the user-facing skill, and the
      release carries them. Red: `pnpm check:diagnostic-xref` and
      `pnpm check:next-marker` over the new codes' sites, plus the
      changeset gate (`changeset status`) with no changeset present.
      Green: `skills/hejbro/references/function-builder-pitfalls.md`
      gains one sentence on argument names being hejbro SQL names
      (`invalid-sql-name`) and one on `ctx.return` requiring
      `.returning()` (`return-expects-returning`), beside the
      `ctx.execute` sentence it mirrors, and one naming
      `ExecutableQuery` as the type `ctx.execute` accepts — a new public
      symbol, so it is named in the skill and in the changeset body, not
      only in the diff; `.changeset/harden-function-dsl.md` is one
      `patch` naming `@hejbro/core`, one paragraph covering both
      refusals and that export.
      Files: `skills/hejbro/references/function-builder-pitfalls.md`,
      `.changeset/harden-function-dsl.md`.

Group close (each): the gate list derived from `.github/workflows/ci.yml`,
not from memory; a forced rebuild (`TURBO_FORCE=1 pnpm check-types`,
which pulls `^build`) before any suite that spawns the built CLI —
turbo's cache is content-addressed, so a plain build can replay old logs
without writing `dist` again; `openspec validate harden-function-dsl --strict` and
`openspec show harden-function-dsl --diff` read in full, with the
schema-vendoring requirement classified MODIFIED. `schema-vendoring`'s
spec file is written by another change in flight, on a different
requirement — after any merge-in, both commands run again before the
archive, since `validate` does not check that a MODIFIED requirement
still exists under the name the delta names. Ledger rows
(`openspec/task-times.csv`) and the README badge/CRAP stamps are the
PR-time close-out commit, written once.
