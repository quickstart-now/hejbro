# Tasks: fix-cli-init-and-vendoring

Two groups, one team (`cl`), plus the D106 round-1 correction group
(`cc`), which runs after both are merged. The groups share no file. Estimates are pure
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

- [x] 1.4 (~10m) `[design]` A configured path holding the wrong kind of
      node stops the run instead of being reported as present. Red:
      `packages/cli/test/init.test.ts` — "refuses a configured path that
      holds the wrong kind of node". Input table (each row a real
      project, the report and the filesystem both asserted):

      | configured field | what sits at the path | expected |
      |---|---|---|
      | `snapshotPath: "db/state.json"` | a directory | coded refusal, nothing created |
      | `migrationsDir: "db/migrations"` | a file | coded refusal, nothing created |
      | `snapshotPath: "db/"` | a directory | coded refusal, nothing created |
      | `snapshotPath: ""` | the project directory itself | coded refusal, nothing created |
      | `snapshotPath: "db/"` | nothing at that path | coded refusal: a file artifact whose path is spelled as a directory |
      | `migrationsDir: "db/migrations"` | a directory | created or skipped as today |
      | `snapshotPath: "db/state.json"` | a file | skipped, byte-untouched |
      | `migrationsDir: ""` and `"."` | the project directory itself | skipped, reported `./` |
      | `migrationsDir` omitted (config present) | — | not created, reported not configured |
      | `snapshotPath` omitted (config present) | — | not created, reported not configured |
      | no config file at all | — | both created at the defaults, as today |

      Green: the presence test asks the node's kind (`statSync`), not
      only its existence; a kind mismatch raises one new code naming the
      path and the kind expected there, and the empty relative label
      renders `./` rather than an empty string or `/`. Code name
      `init-path-conflict` (lead-approved; `invalid-config` is wrong —
      the configuration is valid and the filesystem is not), carrying a
      `Next:` line like every coded failure here. Nothing is ever
      replaced. A configuration present but silent about a field gets no
      artifact for that field and one report line saying so — the
      commands that write migrations refuse without it, so creating one
      would leave a directory nothing reads, and a vendoring-only
      repository must not acquire migration artifacts from `init`.
      Files: `packages/cli/src/commands/init.ts`, its test.

## 2. Two silent losses on the vendoring boundary (#697)

Files this group owns: `packages/cli/src/contract/emit.ts`,
`packages/cli/src/vendor/validate-export.ts`,
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
- [x] 2.2 (~8m) `[design]` The `db.fn` guard refuses an argument key the
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
- [x] 2.3 (~10m) `[design]` A column fact the description holds under a
      key with object-literal meaning reaches the contract. Red:
      `packages/cli/test/contract-emit.test.ts` — "carries the facts a
      description holds under a __proto__ column key", driven through
      the **real pipeline** (hand-written `schema.json` text →
      `validateExport` → `emitContract` → load the emitted module), not
      through a payload built in memory: the loss happens in the reader,
      so a test that starts after the read cannot see it. Input table,
      each column fact carrying a TypeScript key and a numeric mode that
      differ from what a fallback would recover:

      | description column key | expected in the contract |
      |---|---|
      | `__proto__` | the description's own key and mode |
      | `constructor` | the description's own key and mode (control) |
      | `plain` | the description's own key and mode (control) |

      Green: the columns record is assembled so that every own key
      survives — `Object.fromEntries` creates own properties where plain
      assignment does not, so parsing into entries and assembling with it
      is true by construction rather than by test. **Measure first and
      report before choosing**: whether any test or message pins the
      key name in a validation error path (an entries/tuple schema moves
      those paths to indices). If one does, say so and stop — the
      alternative is recovering the dropped key after the record parse.
      Fix the class, not the instance: search `packages/cli/src/vendor`
      for every `z.record` and say which ones carry
      declaring-repository-chosen keys. Also in this task, one comment
      fix: `assertArgNames`'s "there can be at most one past the
      equal-length check" is false (`{user_id, lmt}` against two declared
      arguments has two) — state what the code does, name the first.
      Files: `packages/cli/src/vendor/validate-export.ts`,
      `packages/cli/test/contract-emit.test.ts`,
      `packages/query/src/db/fn.ts` (comment only).

## 3. D106 round-1 corrections (`d106-r1`)

Files this group owns: `packages/cli/src/commands/init.ts`,
`packages/cli/test/init.test.ts`,
`packages/query/src/client/name-keyed-db.ts`,
`packages/query/test/client/errors.test.ts`,
`skills/hejbro/references/query-layer.md`,
`skills/hejbro/references/polyrepo.md`,
`openspec/changes/fix-cli-init-and-vendoring/specs/cli-commands/spec.md`,
`openspec/changes/fix-cli-init-and-vendoring/evaluation.md`,
`.changeset/fix-cli-init-d106-r1.md`.

Groups 1 and 2 are merged, so this group shares a file with neither.

- [x] 3.1 (~8m) `[design]` A configured directory spelled with a trailing
      separator is inspected as the node it names. Red:
      `packages/cli/test/init.test.ts` — "refuses a configured migrations
      directory spelled with a trailing slash that holds a file". The
      claim is universal (every spelling the run honours is inspected),
      so the red starts from an input table, one real temporary project
      per row (D110):

      | field | configured value | what sits at the path | expected |
      |---|---|---|---|
      | `migrationsDir` | `"mig/"` | a regular file at `mig` | `init-path-conflict` naming `mig/` and the expected kind, nothing created |
      | `migrationsDir` | `"mig//"` | a regular file at `mig` | the same refusal |
      | `migrationsDir` | `"db/mig/"` | a regular file at `db/mig` | the same refusal, naming `db/mig/` |
      | `migrationsDir` | `"mig/"` | a directory at `mig` | skipped `mig/` (control) |
      | `migrationsDir` | `"mig/"` | nothing | created `mig/` (control) |
      | `migrationsDir` | `"mig"` | a regular file at `mig` | unchanged from today (control: this message text does not move) |

      Green: the presence and kind check stats the configured path with
      its trailing separators removed, so a spelling the run otherwise
      honours cannot skip the check by making `existsSync` false. Only
      `ENOENT` counts as "nothing is there"; any other stat failure
      becomes `init-path-conflict` naming the label and the operating
      system's own error code, never a raw Node stack — this CLI's
      diagnostics print no absolute path (D57).
      Files: `packages/cli/src/commands/init.ts`, its test.

- [x] 3.2 (~9m) `[design]` A path an artifact must be created inside
      stops the run before anything is created. Red:
      `packages/cli/test/init.test.ts` — "refuses when a directory an
      artifact needs is a file, and creates nothing". Input table:

      | field | configured value | what sits there | expected |
      |---|---|---|---|
      | `snapshotPath` | `"db/snap.json"` | a regular file at `db` | `init-path-conflict` naming `db`, exit 1 |
      | `migrationsDir` | `"db/mig"` | a regular file at `db` | the same refusal |
      | `snapshotPath` | `"a/b/c/snap.json"` | a regular file at `a` | refusal naming `a` — the first node on the way that is not a directory, not the leaf |
      | both fields set, `snapshotPath: "db/snap.json"` | — | a regular file at `db` | nothing is created: no `migrations/`, no `hejbro.config.ts` |
      | `snapshotPath` | `"db/snap.json"` | a directory at `db` | created (control) |
      | `migrationsDir` | `"../out/mig"` | nothing at `../out` | created, reported `../out/mig/` (control: an escaping path is not what this refuses) |

      Green: before anything is created, each planned artifact's ancestor
      chain is walked from its parent upward, and the walk continues past
      both `ENOENT` and `ENOTDIR` — a stat below a file ancestor fails
      with `ENOTDIR`, so treating that as a result rather than as "keep
      going" would name the deepest segment (`a/b/c`) instead of the file
      that actually blocks it (`a`). The walk stops at the first path that
      stats successfully; if that node is not a directory it raises
      `init-path-conflict` naming it. This runs before the leaf's own kind
      check (3.1), so a leaf whose stat fails with `ENOTDIR` is reported
      as the ancestor that caused it — after 3.1 alone, such a run refuses
      naming the leaf, which is the intermediate state this task closes.
      Recursive, never a loop (`check:bans`). The fourth row is the pin
      for the requirement's own "creating nothing": today a refused run
      has already written the migrations directory.
      Files: `packages/cli/src/commands/init.ts`, its test.

- [ ] 3.3 (~8m) `[design]` Two configured fields naming one path stop the
      run. Red: `packages/cli/test/init.test.ts` — "refuses a
      configuration whose fields resolve to the same path". Input table:

      | `migrationsDir` | `snapshotPath` | expected |
      |---|---|---|
      | `"migrations"` | `"migrations"` | `init-path-conflict` naming both fields and the shared path, nothing created |
      | `"mig/"` | `"mig"` | the same refusal — the comparison is of resolved paths, not of spellings |
      | omitted | `"hejbro.config.ts"` | refusal naming `snapshotPath` and the configuration file |
      | `"migrations"` | `"hejbro.snapshot.json"` | both created (control) |
      | omitted | omitted | both reported not configured (control) |

      Green: the planned artifacts' resolved paths are compared pairwise
      before any is created; a repeat raises `init-path-conflict` naming
      the two fields. Today the run creates one and reports the other as
      already present — the "tells a repair run that a broken project is
      whole" the requirement forbids. Also in this task: the delta
      requirement gains one prose clause and one scenario covering this
      case and 3.2's, and the existing wrong-kind scenario's WHEN gains
      the configuration path (3.4).
      Files: `packages/cli/src/commands/init.ts`, its test,
      `openspec/changes/fix-cli-init-and-vendoring/specs/cli-commands/spec.md`.

- [ ] 3.4 (~7m) `[design]` The configuration's own path is checked for
      kind before it is loaded. Red: `packages/cli/test/init.test.ts` —
      "refuses a directory sitting where the configuration file belongs".
      Input table:

      | what sits at `hejbro.config.ts` | expected |
      |---|---|
      | a directory | `init-path-conflict` naming `hejbro.config.ts` and the kind expected there, nothing created, and not `config-load-failed` |
      | a readable configuration | loaded as today (control) |
      | a configuration with an unresolvable import | `config-load-failed`, message unchanged (control) |
      | nothing | scaffolded as today (control) |

      Green: the configuration artifact's kind check runs before
      `loadConfig`; the other two artifacts keep theirs where it is, since
      they need the loaded configuration to know their paths. The
      requirement already names the configuration among the artifacts
      whose wrong-kind path stops the run; today the loader answers
      instead, with a `Next:` line about import resolution.
      Files: `packages/cli/src/commands/init.ts`, its test.

- [ ] 3.5 (~7m) `[design]` A name the contract does not vendor is refused
      even when `Object.prototype` carries one. Red:
      `packages/query/test/client/errors.test.ts` — "refuses a lookup of
      an inherited name the contract does not vendor". Input table, on a
      contract vendoring `posts` and `add` and nothing else:

      | lookup | expected |
      |---|---|
      | `client.fn.__proto__` | `unknown-contract-function` — today `Object.prototype`, then a `TypeError` on the call |
      | `client.__proto__` | `unknown-contract-table` |
      | `client.fn.hasOwnProperty` | `unknown-contract-function` |
      | `client.posts` / `client.fn.add` | the vendored member (control) |
      | `client.fn.__proto__` on a contract that does vendor `__proto__` | the vendored callable (control — the own property wins) |
      | `await client`, `String(client)`, `JSON.stringify(client)` | no refusal: the names the language itself reads stay readable |

      Green: both guards decide "unknown" with `Object.hasOwn` instead of
      `prop in obj`, with one explicit passthrough list — `then`,
      `toString`, `valueOf`, `constructor`, `toJSON` — carrying its
      reason in a one-line comment: an `async` function returning the
      client reads `then` off it, so a passthrough-free guard would
      refuse a correct program.
      Files: `packages/query/src/client/name-keyed-db.ts`, its test.

- [ ] 3.6 (~6m) The skill documents the codes this surface raises and the
      three column names TypeScript will not let a caller write. No test:
      the observer is the file — `references/query-layer.md`'s Errors
      table carries a row for none of these codes today, and "public API
      surface changed → `skills/hejbro` updated in the same PR" was not
      met when they landed.

      | file | edit |
      |---|---|
      | `references/query-layer.md` | Errors table rows for `function-argument-unknown`, `function-argument-count-mismatch`, `unknown-contract-table`, `unknown-contract-function` |
      | `references/polyrepo.md` | one sentence: a column named `constructor`, `toString` or `hasOwnProperty` is carried faithfully by the contract, but TypeScript resolves those names on every object type, so a write literal against such a table cannot type-check — a schema should not name a column that way. TypeScript's own rule, not the emitter's |

      Close: `.changeset/fix-cli-init-d106-r1.md` (`patch`, `hejbro`), one
      paragraph in user-facing terms covering the `init` refusals and the
      contract-name guard.
      Files: those two references, the changeset.

- [ ] 3.7 (~6m) The round's own disposition is written down. Files:
      `openspec/changes/fix-cli-init-and-vendoring/evaluation.md` — a
      `## Round 1 disposition` section, one line per item (B1, N1–N8):
      what was done, or why not, with the task that carries it. N4 and N5
      are filed (#745, #743) and untouched here; N8 is recorded as a plain
      fix with no delta, because no specification anywhere states what a
      name-keyed lookup of an unvendored name does — a gap for whenever
      the client surface gets a capability spec.

Group close (each group): `openspec validate fix-cli-init-and-vendoring
--strict` and `show --diff` with the MODIFIED requirement classified
MODIFIED, then the CI-derived gate sweep in a detached worktree with
`TURBO_FORCE=1`. Ledger rows and README badges are the lead's PR-time
commit.
