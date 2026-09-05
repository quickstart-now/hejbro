# Tasks: add-config-driver

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/cli/src/config.ts`, `packages/cli/test/
config*.test.ts` (1.1); `packages/cli/src/check/driver.ts`,
`packages/cli/test/check-driver.test.ts`, and the four sites that build
a `ConnectionCodes` literal — `packages/cli/src/apply/capability.ts`
(`APPLY_CONNECTION_CODES`, shared by `migrate`/`status`/`reset`/
`raise`) plus the inline literals in `commands/{check,import,pull}.ts`
(1.2, one code string each and nothing else: a fourth *required* field
stops those files compiling until they carry it, and making it optional
would reopen the defaulted-code channel `check/driver.ts`'s own header
forbids); `packages/cli/src/loader.ts` + `packages/cli/test/loader.test.ts` (1.3, the lenient load
— see below); the seven command files under `packages/cli/src/commands/`
with their in-process tests (1.3, 1.4); `examples/cli-smoke/test/
*.test.ts` + a fixture config (1.5); `skills/hejbro/references/
{supabase,neon,nile}-preset.md`, one `.changeset/*.md` (1.6). If a task
appears to need any other file, that goes back to the planner, not into
the diff.

**`loader.ts` is in the list by lead ruling 458/R2** (planner check
before 1.1: `runImport`, `runPull` and `runRaise` never call
`loadConfig` at all — only `check`, `status`, `migrate` and `reset` do).
The delta requires all seven to honour the field, and `loadConfig`
throws `config-not-found` when the file is absent — which is the normal
state for the very commands that bootstrap a project from a database.
The lenient load (absent file → no factory; every other load failure →
refuse) is one helper shared by the three, so it lives in `loader.ts`
next to `loadConfig` rather than being written three times in
`commands/`. There is no shared apply-engine connection site: the four
apply commands each call `withCheckConnection` directly.

**Ordering.** 1.1 → 1.2 → 1.2b → 1.3 and 1.4 (independent of each
other, both on 1.2b) → 1.5 → 1.6. 1.2b is inserted by lead ruling
458/R2; the numbering keeps 1.3–1.6 as they were so commits and
`task-times.csv` rows already spelled against them stay valid.

## 1. A configured driver factory

- [x] 1.1 (~7m) **[design]** The `driver` field. Settles the type
      (`(connectionString: string) => Driver | Promise<Driver>` on
      `HejbroConfig`), the schema (a function, nothing else) and the
      shape hint's wording. Red: the config loader's test, a table:
      {absent → loads, `driver` undefined}; {a function → loads, the same
      function}; {a string / an object / `null` → fails naming
      `"driver"` and the shape}. Files: `packages/cli/src/config.ts`,
      its test.

- [x] 1.2 (~9m) **[design]** Procurement prefers the factory. Settles
      the unclosable refusal's code (`<prefix>-driver-unclosable`, a
      fourth literal in `ConnectionCodes`, spelled at each call site like
      the other three) and message. Red: `packages/cli/test/
      check-driver.test.ts`, a table over `connectForCheck`/
      `withCheckConnection` with an optional `factory`: {factory set →
      called once with the resolved string, importer never called,
      driver returned; closed after body}; {factory async → awaited};
      {factory throws → `connectionFailed` code, message describes the
      error, importer never called}; {factory returns a driver without
      `client.end` → the unclosable code, nothing sent}; {no factory →
      importer path byte-identical, including the missing-package
      diagnostic}; {`--url`/`DATABASE_URL` absent → connection-missing
      before the factory runs}. Files: `packages/cli/src/check/driver.ts`,
      the test.

- [x] 1.2b (~6m) **[design]** The lenient configuration load, for the
      three commands that never read one (lead ruling 458/R2). Settles
      the helper's name and return shape (the configuration when it
      loads, `null` when no file is there — never a partial
      `HejbroConfig`). Red: `packages/cli/test/loader.test.ts`, a table:
      {no `hejbro.config.ts` in `cwd` → `null`, no throw}; {a valid
      config → the same `HejbroConfig` `loadConfig` returns, `driver`
      included}; {a config whose `driver` is a string → throws
      `invalid-config`, the message unchanged from `loadConfig`'s};
      {a config path that is a directory → `config-not-a-file`
      unchanged}; {an unreadable config → `config-unreadable`
      unchanged}. The helper takes **no `--config` argument at all** and
      always loads the default path: `loadConfig` throws
      `config-not-found` for both "no default file" and "`--config`
      named a file that isn't there" (loader.ts:271-288), so a helper
      that took the flag and absorbed that code by its code alone would
      silently swallow a typo in a path the user typed. Keeping the
      flag out makes the absorbed case exactly one thing; when
      `harden-config-root` gives these commands `--config`, it has to
      confront the distinction deliberately. Narrow on the hejbro error
      code with the existing guard and rethrow everything else — never
      on message text. Files: `packages/cli/src/loader.ts`, its test.

- [x] 1.3 (~9m) `check`, `status`, `pull` thread the configured factory.
      Red: each command's in-process test gains a case: a config whose
      `driver` is a recording factory → the factory is called with that
      command's own connection flag value (`--db-url` for `pull`,
      `--url` for the other two), the command's statements reach the
      recording driver, the importer is never consulted; and the
      existing no-factory cases stay green. `pull` reads no
      configuration today, so it gains 1.2b's lenient load and one more
      case: {no config file → the vanilla importer path, byte-identical
      to today}. Files: the three command files, their tests.

- [x] 1.4 (~9m) `migrate`, `raise`, `reset`, `import` thread it too.
      Same red shape as 1.3 per command; plus, for one apply command, a
      recording driver declaring `interactive-transactions: false` is
      refused by the existing capability check exactly as an imported
      one would be. `raise` and `import` read no configuration today —
      both gain 1.2b's lenient load and `pull`'s extra case (no config
      file → unchanged vanilla path). Neither gains a `--config` flag:
      that gap is real and belongs to `harden-config-root`, not here.
      Files: the four command files, their tests.

- [x] 1.5 (~8m) End to end over the built CLI. Red: `examples/cli-smoke/
      test/config-driver.e2e.test.ts` (subprocess, `assertBuiltCli`): a
      temp project whose `hejbro.config.ts` exports a `driver` factory
      that writes what it was called with to a file and returns a
      minimal closable recording driver; `hejbro check --url
      postgres://x` runs and the file names that string; the same
      project with `driver: "pg"` fails at config load naming the field.
      Files: the test and its fixture.

- [x] 1.6 (~6m) Docs and changeset. `supabase-preset.md` shows `driver:
      (url) => supabaseDriver(pgDriver(url), { endpoint:
      "transaction-pooler" })` and says which commands use it;
      `neon-preset.md` and `nile-preset.md` the equivalent one-liner;
      `pnpm changeset` → `minor`. `brownfield-adoption.md` is in the
      list too (planner check before 1.6): its line 78 states flatly
      that `check` "needs the `@hejbro/pg` package installed", which
      this change makes false whenever a factory is configured — a
      stale skill is a broken user contract, not a docs nit. Files: the
      three preset references, `brownfield-adoption.md`,
      `.changeset/*.md`.

### Review round 1 (reviewer at 0311f061)

Three tasks the piece review turned up. Each one is the delta's own
sentence failing on an input the sentence covers, so each is repaired
here rather than deferred: a scenario that only holds for the inputs
the implementer happened to pick is not a scenario.

- [x] 1.7 (~6m) A factory returning nothing is refused, not a crash.
      `hasClosableClient` (`check/driver.ts:140`) reads `.client` off
      the returned value without first confirming it is a non-null
      object, so `null`/`undefined` reach the user as a raw `TypeError`
      instead of the coded refusal L130-133 promises for a driver with
      no way to close. The reachable spelling is an arrow function that
      forgot its `return` — the shape the preset docs themselves show.
      Red: extend `check-driver.test.ts`'s unclosable input table with
      `null` and `undefined` rows (its neighbours — `{client:null}`,
      `{client:{end:42}}`, a top-level `end`, a number — already pass).
      No new code: these two belong on the existing refusal path.
      Files: `packages/cli/src/check/driver.ts`, its test.

- [x] 1.8 (~9m) **[design]** The connection diagnostics name the
      command's own flag. `driver.ts:69` and `:233` hard-code `--url`
      while interpolating `commandName`, so `hejbro pull` refuses by
      telling the user to pass a flag it ignores — following the
      `Next:` line reproduces the same error. The text predates this
      change, but this change is what made the delta assert per-command
      flags (L123-125, L172-177) and what put `pull` on this path, and
      the `.changeset` entry this PR adds repeats the same claim.
      Settles how the flag reaches the message: a literal on
      `ConnectionContext` beside `commandName`, supplied at each call
      site exactly as the codes are (never assembled), so the four
      apply commands' shared context carries `--url` and `pull`'s
      carries `--db-url`. Red: a table over the two messages ×
      {`check`-shaped context → `--url`; `pull`'s context → `--db-url`}
      plus one per-command assertion that no message names a flag its
      command does not accept. Fix the `.changeset` wording in the same
      task. Files: `packages/cli/src/check/driver.ts`,
      `packages/cli/src/apply/capability.ts`, `commands/{check,import,
      pull}.ts`, `check-driver.test.ts`, `.changeset/*.md`.

- [x] 1.9 (~5m) `describeDriverError` describes an object that carries
      a message. L179-183 says the connection-failed message describes
      the thrown error; a thrown `ErrorEvent` renders as
      `[object ErrorEvent]`, describing nothing. This is pre-existing
      code, repaired here because 1.6's own `neon-preset.md` now
      recommends the WebSocket `Pool` path, and that path throws
      exactly this on a failed connection — the documented happy path's
      failure message would be the useless one. Structural, never a
      type test: any object whose `message` is a string. Red: the
      thrown-value table (`Error`, bare string, `{code}`,
      `AggregateError`, nested `cause`, `null` — all already passing)
      gains a row for an object with a string `message`. Files:
      `packages/cli/src/check/error-message.ts`, its test.
      *Settled during the task, measured by rewinding the module:* a
      plain object carrying **both** `code` and `message` used to
      render its `code` and now renders its `message`. That is the
      point of the task rather than a side effect — the old rule keyed
      on the *class* (`instanceof Error`), so the same two fields
      rendered one way inside an `Error` and another way in a plain
      object. Keying on the shape makes those two agree. Only that
      narrow set moves: a real `Error` carrying a `code` took the
      message branch before and after.

- [x] 1.10 (~6m) The Neon WebSocket driver exposes its pool as `client`
      (lead ruling 458/R3). `buildWebSocketDriver` returns an object
      with no `client` member, so the one line `neon-preset.md`
      recommends is the one shape the CLI refuses — the delta's closing
      promise would be false for one of the three shipped presets, so
      the preset is fixed rather than the documentation worked around
      (D13: complete within the purpose). Mirror how `pgDriver` exposes
      its own pool. Red: `neonDriver(pool).client === pool` in the neon
      driver's test, and the e2e proving the documented one-liner
      (`driver: (url) => neonDriver(pool)`) reaches close — a recording
      pool's `end` called exactly once. Remove the
      `{ ...neonDriver(pool), client: { end: … } }` workaround from
      `neon-preset.md`. The existing `minor` changeset covers this (the
      seven packages are a fixed group). Files:
      `packages/neon/src/driver.ts`, its test,
      `skills/hejbro/references/neon-preset.md`, the e2e.

- [x] 1.11 (~5m) **[design]** Closing Neon's HTTP driver does nothing,
      and says so (lead ruling 458/R4). `buildHttpDriver` opens no
      connection, so it exposes no `client` and the CLI refuses it for
      a fault it does not have — which takes `check`, `status`,
      `import` and `pull` away from the serverless path those commands
      suit. Settles the member's shape: **not** the underlying `sql`
      handle dressed up as a client. `pgDriver` and 1.10's WebSocket
      driver expose `client` because a pool really is there; here there
      is none, and handing back a fake handle would claim a capability
      the object does not have. It exposes the minimum the close
      contract needs — an object whose `end` resolves — and the comment
      states only the constraint: nothing is held open, the CLI's close
      path needs a member to call. Red: `neonDriver(sql).client.end()`
      resolves **and never calls `sql`** (a recording queryable proves
      the second half — a close that quietly issued a statement would
      be the opposite of no-op); the apply commands' existing
      `interactive-transactions` refusal is unchanged. One line in
      `neon-preset.md`'s two-path section. Files:
      `packages/neon/src/http.ts`, its test, `neon-preset.md`.
