# Tasks: add-config-driver

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/cli/src/config.ts`, `packages/cli/test/
config*.test.ts` (1.1); `packages/cli/src/check/driver.ts`,
`packages/cli/test/check-driver.test.ts` (1.2); the seven command files
under `packages/cli/src/commands/` (and the apply-engine site that opens
their connection, if it is shared) with their in-process tests (1.3,
1.4); `examples/cli-smoke/test/*.test.ts` + a fixture config (1.5);
`skills/hejbro/references/{supabase,neon,nile}-preset.md`, one
`.changeset/*.md` (1.6). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 and 1.4 (independent of each other) →
1.5 → 1.6.

## 1. A configured driver factory

- [ ] 1.1 (~7m) **[design]** The `driver` field. Settles the type
      (`(connectionString: string) => Driver | Promise<Driver>` on
      `HejbroConfig`), the schema (a function, nothing else) and the
      shape hint's wording. Red: the config loader's test, a table:
      {absent → loads, `driver` undefined}; {a function → loads, the same
      function}; {a string / an object / `null` → fails naming
      `"driver"` and the shape}. Files: `packages/cli/src/config.ts`,
      its test.

- [ ] 1.2 (~9m) **[design]** Procurement prefers the factory. Settles
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

- [ ] 1.3 (~9m) `check`, `status`, `pull` thread the configured factory.
      Red: each command's in-process test gains a case: a config whose
      `driver` is a recording factory → the factory is called with the
      `--url` string, the command's statements reach the recording
      driver, the importer is never consulted; and the existing
      no-factory cases stay green. Files: the three command files, their
      tests.

- [ ] 1.4 (~9m) `migrate`, `raise`, `reset`, `import` thread it too.
      Same red shape as 1.3 per command; plus, for one apply command, a
      recording driver declaring `interactive-transactions: false` is
      refused by the existing capability check exactly as an imported
      one would be. Files: the four command files (and the shared
      apply-engine connection site if there is one), their tests.

- [ ] 1.5 (~8m) End to end over the built CLI. Red: `examples/cli-smoke/
      test/config-driver.e2e.test.ts` (subprocess, `assertBuiltCli`): a
      temp project whose `hejbro.config.ts` exports a `driver` factory
      that writes what it was called with to a file and returns a
      minimal closable recording driver; `hejbro check --url
      postgres://x` runs and the file names that string; the same
      project with `driver: "pg"` fails at config load naming the field.
      Files: the test and its fixture.

- [ ] 1.6 (~6m) Docs and changeset. `supabase-preset.md` shows `driver:
      (url) => supabaseDriver(pgDriver(url), { endpoint:
      "transaction-pooler" })` and says which commands use it;
      `neon-preset.md` and `nile-preset.md` the equivalent one-liner;
      `pnpm changeset` → `minor`. Files: the three references,
      `.changeset/*.md`.
