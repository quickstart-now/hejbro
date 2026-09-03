# Tasks: fix-cli-init-and-vendoring

Two groups, one team (`cl`). The groups share no file. Estimates are pure
work minutes. Every task starts from its named red test. Verification
(gates, `openspec validate --strict`, `show --diff`) is the definition of
done, never a task.

## 1. init reads the configuration it scaffolds beside (#687)

Files this group owns: `packages/cli/src/commands/init.ts`,
`packages/cli/test/init.test.ts`,
`skills/hejbro/references/generate-verify-workflow.md`.

- [x] 1.1 (~9m) `[design]` `init` places the migrations directory and the
      snapshot at the configured paths and reports the path it acted on.
      Red: `packages/cli/test/init.test.ts` — "creates the migrations
      directory and the snapshot at the configured paths". The
      requirement's claim is universal ("wherever the configuration
      says"), so the red starts from an input table, run against a real
      temporary project per row (D110):

      | `hejbro.config.ts` | field value | directory created | report line |
      |---|---|---|---|
      | absent | — | `<cwd>/migrations` | `created migrations/` |
      | present | field omitted | `<cwd>/migrations` | `created migrations/` |
      | present | `"db/migrations"` | `<cwd>/db/migrations` | `created db/migrations/` |
      | present | `"db/migrations/"` | `<cwd>/db/migrations` | `created db/migrations/` |
      | present | `"/db/migrations"` | `<cwd>/db/migrations` | `created db/migrations/` |

      and the same five rows for `snapshotPath` (`hejbro.snapshot.json`,
      `db/hejbro.snapshot.json`, `snap/state.json`), the file being
      written with `renderSnapshot(emptySnapshot)` as today.
      Green: `runInit` becomes `async`, and when `hejbro.config.ts`
      exists at `cwd` it reads it through `loadConfig` — the loader every
      other command uses, no second reader — then resolves each artifact
      with `join(cwd, value)`, which is exactly how `generate`,
      `history` and `status` resolve the same two fields
      (`snapshot-file.ts`, `commands/history.ts`), so `init` cannot
      create a path they will not read. The absolute-looking row is
      pinned for that reason: `join` is the contract, not `resolve`.
      Files: `packages/cli/src/commands/init.ts`, its test.
- [x] 1.2 (~8m) `[design]` A configuration that cannot be read stops the
      run before anything is created. Red:
      `packages/cli/test/init.test.ts` — "creates nothing when the
      configuration beside it cannot be read", two rows: a
      `hejbro.config.ts` importing a package that does not resolve
      (`config-load-failed`), and one whose default export does not match
      the configuration shape (`invalid-config`); each asserts the
      directory and the snapshot are absent afterwards and the exit code
      is 1. Green: the house pattern `commands/link.ts` already uses —
      `try`/`catch`, `asHejbroError` → `fromHejbroError` →
      `renderDiagnostics`. `InitResult` becomes
      `{ report, exitCode: 0 | 1, stderr: string | null }` and
      `initCommand` prints `stderr` and sets the code; `runInit` mints no
      code of its own. Files: `packages/cli/src/commands/init.ts`, its
      test.
- [x] 1.3 (~7m) A partially present project is repaired at the configured
      paths, and the skipped lines name those paths too. Red:
      `packages/cli/test/init.test.ts` — "creates only the configured
      snapshot when the configured migrations directory exists": the
      report reads `skipped hejbro.config.ts (exists)`, `skipped
      db/migrations/ (exists)`, `created db/hejbro.snapshot.json`, the
      existing directory's contents are untouched, and the exit code is
      0. Close: the `hejbro init` sentence in
      `skills/hejbro/references/generate-verify-workflow.md` says it
      honours an existing configuration's paths. Files:
      `packages/cli/src/commands/init.ts`, its test, that reference.

## 2. Two silent losses on the vendoring boundary (#697)

Files this group owns: `packages/cli/src/contract/emit.ts`,
`packages/cli/test/contract-emit.test.ts`,
`packages/query/src/db/fn.ts`,
`packages/query/test/client/functions.test.ts`,
`packages/query/test/db/fn.test.ts` (only if a case there must adapt —
its existing calls all pass declared keys, so none is expected to),
`.changeset/fix-cli-init-and-vendoring.md`.

No specification outside `schema-vendoring` promises the shape of this
runtime check: `typed-function-execution`'s "Argument mismatches fail
the type check" claims the compile-time error and "no runtime coercion",
and `diagnostics` names no argument code — so this group carries one
delta, not three. The code itself is cited in no document, so the
one-way documentation cross-check is unaffected by adding a sibling.

- [x] 2.1 (~9m) `[design]` Every emitted metadata key is an own property
      of `contractMetadata`. Red:
      `packages/cli/test/contract-emit.test.ts` — "carries a column key
      that would otherwise set the prototype". The input is a
      hand-written export payload and snapshot literal, never one this
      emitter produced: `schema.json` is a committed, hand-editable file
      and a `pull`-inferred column name comes from a catalog, so this key
      arrives from outside hejbro's own output (D110). Input table, each
      name at each of the three key positions the metadata carries —
      column key, table key, function export-name key:

      | key name | own property expected |
      |---|---|
      | `__proto__` | yes (the defect: silently absorbed today) |
      | `constructor` | yes (control) |
      | `prototype` | yes (control) |
      | `hasOwnProperty` | yes (control) |
      | `toString` | yes (control) |

      The assertion runs the generated code rather than matching its
      text: write the emitted module to a temporary directory, import
      it, and assert `Object.hasOwn(...)` and `Object.keys(...)` see the
      key — a string-matching test passes today for four of the five
      rows and says nothing about the fifth. Green: one
      `renderMetadataKey` helper in `contract/emit.ts` emitting
      `["__proto__"]` for that one name and `JSON.stringify` for every
      other, used at all three key sites. Design detail: the computed key
      must keep its literal key type under `as const` — the observer for
      that is `pnpm check-types`, not vitest. Files:
      `packages/cli/src/contract/emit.ts`, its test.
- [ ] 2.2 (~8m) `[design]` The `db.fn` guard refuses an argument key the
      declaration does not name. Red:
      `packages/query/test/client/functions.test.ts` — "refuses a
      right-sized argument object naming an argument the function does
      not declare, and never reaches the driver", against a recording
      driver, with a **pre-built value** (not a fresh literal: the
      compile-time excess-property check never runs for one). Input
      table, for a function declaring `{ userId, limit }`:

      | caller's object | outcome |
      |---|---|
      | `{ userId, limit }` | sent |
      | `{ limit, userId }` | sent (key order is not the contract) |
      | `{ user_id, limit }` | refused, naming `user_id` and the declared arguments |
      | `{ userId, limit, extra }` | refused by the existing count check, its message unchanged |
      | `{ userId }` | refused by the existing count check, its message unchanged |
      | `{}` against a no-argument function | sent |

      Green: an `assertArgNames` helper beside `assertArgCount`, run
      after it (so no existing count-mismatch message moves), throwing
      the same D57-enriched plain `Error` shape with its own code; the
      first unknown key by the caller's own key order is named, the way
      the loader reports the first failing entry rather than a batch.
      Close: `.changeset/fix-cli-init-and-vendoring.md` (`patch`,
      `hejbro` — the seven packages version together), one paragraph
      covering all three fixes in user-facing terms, the guard among
      them. Files:
      `packages/query/src/db/fn.ts`, its test, the changeset.

Group close (each group): `openspec validate fix-cli-init-and-vendoring
--strict` and `show --diff` with the MODIFIED requirement classified
MODIFIED, then the CI-derived gate sweep in a detached worktree with
`TURBO_FORCE=1`. Ledger rows and README badges are the lead's PR-time
commit.
