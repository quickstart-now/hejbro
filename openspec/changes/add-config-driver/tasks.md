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
