# harden-function-dsl — D106 adversarial spec review

## Round 1

Context-free review of the three delta specs against the shipped behavior at
`b02443a8` (dev, PR #733 merged). Every scenario was exercised with inputs
beyond its own examples; the shipped `dist` was loaded, not only read.

### Verdict

BLOCKING 0 / NON-BLOCKING 2 / OK 9

### Blocking

None.

### Non-blocking

- **N1 — argument-name parity with columns stops short of the duplicate
  check.** `function-declaration` › "An argument name is a hejbro SQL name"
  says an argument's SQL name is derived "exactly as a column's name is
  derived from its key". A table's derivation also refuses two keys that
  derive to the same name (`packages/core/src/dsl/table.ts:271-278`,
  `buildColumnEntries`); `resolveArgs` (`define-function.ts:229-245`) does
  not. `defineFunction(app, "d", { args: { userId: uuid(), user_id: uuid() },
  … })` is accepted and renders `(user_id uuid, user_id uuid)`; Postgres 15
  rejects it at CREATE with `parameter name "user_id" used more than once`
  — the same "unparseable DDL emitted silently" class this change closes
  for single keys. No delta scenario names duplicates, so this is an
  over-claim in the requirement sentence plus a follow-up, not a
  contradiction.
- **N4 — the `return-expects-returning` requirement is worded wider than
  its scenario.** The requirement says `ctx.return` "SHALL refuse one that
  does not [end in `.returning()`] … with `return-expects-returning`",
  unscoped by return kind. Shipped: only a `setof <table>` body reaches
  that code; a scalar body returning a bare `insert(...)` fails first with
  `scalar-return-expects-expression`, a trigger body with
  `trigger-return-expects-row` (`body-context.ts:538-566`, checks run in
  that order, deterministic). Both are pre-existing specified refusals and
  the scenario itself is scoped to `setof <table>`, so behavior matches the
  scenario; the requirement's first sentence should carry the same scope.

### Verified scenarios

**function-declaration (ADDED)**
- OK — *An argument key whose derived name is not a hejbro SQL name is refused*: `invalid-sql-name` for `my-arg`, `2nd`, `Weight` (→`_weight`), `Select` (→`_select`), `my arg`, `q"k`, `café`, `한글`, `""`, `a.b`, `$x`, `_x`, computed `["__proto__"]`, spread `{ ...{ ["__proto__"]: … } }`; message names function (`app.fn1`), declared key and derived name; throws, so no declaration exists. Through the CLI: `error[invalid-sql-name]` with `at src/bad.schema.ts:3:54`, no migration written. Controls accepted: `userID`→`user_i_d`, `x_`, `a1`, `constructor`, `hasOwnProperty`→`has_own_property`, `toString`→`to_string`. (`define-function.ts:230-235`, `identifier-rules.ts:26-39`; `test/define-function.test.ts` "#679" table, 8 rows.)
- OK — *A literal `__proto__` key is refused rather than silently dropped*: `{ __proto__: uuid() }` and `{ __proto__: uuid(), realArg: text() }` → `args-prototype-key`, message names `["__proto__"]`; no declaration. `Object.create(null)` args accepted (`status`). A foreign prototype (`Object.create({ghost})`) is refused with the same code, as the requirement text says; the message states the observation before its usual cause. Through the CLI: `error[args-prototype-key]`. (`define-function.ts:205-219`.)
- OK — *A camelCase key still declares a snake_case argument*: `{ userId, maxCount }` → `args[].key`/`argName` = `userId`/`user_id`, `maxCount`/`max_count`; rendered `create or replace function "app"."echo_camel"(user_id uuid, max_count integer) … return user_id;` applied to PG 15.19 and called → returns the uuid.
- OK — *A reserved word keeps its own refusal*: `select`, `new` → `reserved-local-name`; SQL-name check runs first per key (`Select` → `invalid-sql-name`), keys are checked in declaration order (`{ select, "a-a" }` → reserved; `{ "a-a", select }` → invalid-sql-name) — stable.

**plpgsql-function-bodies (ADDED)**
- OK — *A mutation with no returning cannot be returned*: type level — `tsc --noEmit` (strict, bundler resolution against the built `hejbro`/`@hejbro/core` d.ts) reports every `@ts-expect-error` on `ctx.return(insert(posts).values(…))`, `update(...).set(…)`, `update(...).set(…).where(…)`, `deleteFrom(posts)`, `deleteFrom(posts).where(…)`, and `insert(...).values(…).onConflictDoNothing(posts.id)` as used (harness sanity: a deliberately unused directive did produce TS2578). Runtime with the type bypassed, `returns: posts` — insert/update/delete/delete+where/insert+onConflict → `return-expects-returning`, message names the kind ("received an insert that never called .returning()") and both forms ("add .returning() … or run it with ctx.execute(...)"). (`body-context.ts:455-467`; `render-body.test.ts` "#686" table.) Live PG confirms the motive: a hand-written `return query insert … ` without RETURNING is `CREATE FUNCTION` ok and fails only on call with `INSERT query does not return tuples`.
- OK — *A returning mutation is returned as before*: bare `.returning()` on insert/update/delete and projected `.returning({…})` on insert/delete compile (tsc) and declare; rendered `return query insert … returning "id", "title", "views";` / projected `returning "app"."posts"."id" as "id", …` / `update … returning …` / `delete … returning …` were applied to PG 15.19 and each function called successfully (`ins_ret`, `ins_proj`, `upd_ret`, `del_ret`).
- OK — *An executed mutation is unaffected*: `ctx.execute` of insert/update/delete (and update+where, insert+onConflict) without `.returning()` compiles and declares in setof, scalar and trigger bodies; `exec_eff` (insert + update for effect, then `return query select`) applied to PG 15.19 and called → 3 rows, views bumped. `ctx.execute` of a bare or projected `.returning()` still fails `execute-expects-no-returning`, and both stages are assignable to `ExecutableQuery` while the pre-returning stage is not assignable to `ReturnableQuery` (tsc pins, `ExecutableQuery` imported from both `hejbro` and `@hejbro/core`; `Parameters<BodyContext["execute"]>[0]` ≡ `ExecutableQuery`). Changeset and `skills/hejbro/references/function-builder-pitfalls.md` name the same surface.

**schema-vendoring (MODIFIED)**
- OK — *A non-identifier key is quoted*: a real `generate --export` (throwaway schema repo, built `dist/cli.js`), `.hejbro/export/schema.json` hand-edited so the table fact carries column keys `user-id` and `__proto__`, the function fact argument keys `my-arg` and `__proto__`, and a function `exportName` `__proto__`; committed; consumer `hejbro link file://… && hejbro vendor` → `contract.ts` compiles under strict tsc; `Row`/`Insert`/`Update` carry `readonly "user-id"`, `Args` carries `readonly "my-arg"`, `Database["Functions"]["__proto__"]` resolves; loaded through jiti, `Object.keys(contractMetadata.tables.posts.columns)` = `['id','__proto__','user-id','readTime']` with `Object.hasOwn(…, "__proto__")` true and the prototype intact, `Object.keys(contractMetadata.functions)` = `['addPost','__proto__']`, arg keys `['__proto__','readTime','my-arg']`. (`contract/tables.ts:139-145` `renderKey`, `contract/emit.ts:200-205` `renderMetadataKey`; `test/contract-emit.test.ts` 31 passed.) The requirement's premise also holds: a key that survives `toSnakeCase` + `^[a-z][a-z0-9_]*$` can only contain `[A-Za-z0-9_]` and start with `[a-z]`, i.e. is always a TS identifier, so such keys reach the emitter only from an edited export — as the scenario now says.
- OK — *An interval column compiles*: same run — `readTime: interval()` column and `readTime: interval()` argument → `import type { IntervalValue } from "hejbro"` emitted once, `Row.readTime: IntervalValue | null`, `Args.readTime: IntervalValue`; compiles.
- OK (pinned by the lead's ask) — two consecutive `generate --export` runs (first a real migration, second "no changes") leave `format.json`/`schema.json`/`snapshot.sql` byte-identical (sha256 checked).

### Method

- Build: the worktree's pre-built `dist` at `b02443a8` (`packages/core/dist/index.js`, `packages/cli/dist/cli.js`), loaded via symlinked `node_modules` in a throwaway `_r1probe/` (deleted afterwards). No `pnpm build`/`install`, no workspace-wide gates.
- Loaded vs read: runtime probes ran against `@hejbro/core` dist (28 argument-key rows, 21 `ctx.return`/`ctx.execute` stage rows, ordering rows); type pins ran with the repo's `tsc` (`node_modules/.bin/tsc`, `strict`, `exactOptionalPropertyTypes`, `moduleResolution: bundler`) against the dist `.d.ts` of `hejbro` and `@hejbro/core`; the CLI was driven as a subprocess for `init`, `generate`, `generate --export` (×2), `link`, `vendor`. Source read for line references: `dsl/define-function.ts`, `sql/identifier-rules.ts`, `plpgsql/reserved.ts`, `plpgsql/body-context.ts`, `query/mutate.ts`, `contract/{emit,tables,functions}.ts`, `vendor/{fetch,validate-export,write}.ts`, `core/src/index.ts`, `cli/src/index.ts`, `.changeset/harden-function-dsl.md`, `skills/hejbro/SKILL.md` + `references/function-builder-pitfalls.md`.
- Live Postgres: `postgres:15` container (PostgreSQL 15.19), own container/port, removed with `docker rm -v` afterwards. Applied the six rendered functions and called each; also the two motivating negatives (returning-less `return query insert` → create ok / call fails; unquoted `my-arg` parameter → syntax error) and N1's duplicate parameter name.
- Tests run: `packages/core` `test/define-function.test.ts` + `test/plpgsql/render-body.test.ts` (54 passed), `packages/cli` `test/contract-emit.test.ts` (31 passed) via each package's `vitest run --root`. (`pnpm --filter @hejbro/core test -- <file>` did not narrow to the file and ran the full core suite, 99 files / 1530 passed.)
- Not read: proposal.md, design.md, tasks.md, PR bodies, git log messages, `blackbox/`, `.agents/`; `openspec show` not run.
