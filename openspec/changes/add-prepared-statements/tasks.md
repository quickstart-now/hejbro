# Tasks: add-prepared-statements

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/query/src/driver/contract.ts` and every
test file in this repository that spells a capability declaration (1.1);
`packages/pg/src/driver.ts` + `packages/pg/test/driver.test.ts` (1.2);
`packages/neon/src/driver.ts`, `packages/neon/src/http.ts` +
`packages/neon/test/driver.test.ts` (1.3); `packages/supabase/src/
driver.ts`, `packages/supabase/src/pooler.ts` + `packages/supabase/test/
driver.test.ts`, `pooler.test.ts` (1.4); `packages/pg/test/
integration.test.ts` (1.5, Docker-gated); `skills/hejbro/references/
query-layer.md`, `supabase-preset.md`, `neon-preset.md` and one
`.changeset/*.md` (1.6). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 first (every other task's types depend on it). 1.2,
1.3 and 1.4 are independent of each other after 1.1. 1.5 witnesses 1.2
on a real server and follows it; 1.6 documents everything and comes last.

## 1. Prepared statements behind the capability

- [ ] 1.1 (~9m) **[design]** The capability set names three keys.
      Settles the key's spelling (`prepared-statements`, kebab-case like
      its two siblings) and that the union stays closed. Red:
      `packages/query/test/driver/contract.test.ts`, the existing
      exhaustiveness case extended to three keys (a declaration missing
      `prepared-statements` fails `tsc`; one naming a fourth key fails
      `tsc`), plus `packages/query/test/exports.test.ts` if it pins the
      key list. Green: `DriverCapabilityKey` gains the key; every
      `DriverCapabilities` literal in `packages/*/src`, `packages/*/test`
      and `examples/**` gains `"prepared-statements": false` (the
      recording driver, the conformance fixtures, the CLI fakes — one
      mechanical edit each, `false` everywhere because no existing fake
      prepares). The conformance kit keeps reading only the two session
      keys. Files: `packages/query/src/driver/contract.ts`, the test
      files the type error names.

- [ ] 1.2 (~9m) **[design]** `pgDriver` prepares on request. Settles
      the option name (`preparedStatements`), that both overloads take
      it as a second argument, the name format (`hejbro_` + 32 hex of
      SHA-256 over the text) and the kind rule. Red:
      `packages/pg/test/driver.test.ts`, new describe *"names built
      statements only when the caller asked"*, one `it.each` over an
      input table run against a fake pool that records every query
      config:

      | option | kind | params | expected `name` |
      |---|---|---|---|
      | `true` | `select` | `[]` | `hejbro_` + 32 hex |
      | `true` | `insert` / `update` / `delete` / `setOp` | `[1]` | present |
      | `true` | `sql` (one command, params) | `[1]` | absent |
      | `true` | `sql` (two commands) | `[]` | absent |
      | absent | every kind | — | absent, config deep-equals today's |
      | `false` | `select` | — | absent |

      Also pin: same text → same name across two drivers built over two
      pools; one-character difference → different name; every name ≤ 63
      bytes; the transaction path names too (the session handed to the
      callback); the checkout pin (`SETUP_SESSION_SQL`, a `sql` kind)
      stays unnamed; `capabilities["prepared-statements"]` mirrors the
      option for both overloads. Green: `makeSession` takes the
      declaration, adds `name` for built kinds; `node:crypto` for the
      hash. Files: `packages/pg/src/driver.ts`, `packages/pg/test/
      driver.test.ts`.

- [ ] 1.3 (~6m) `neonDriver` prepares on request on its `Pool` path.
      Red: `packages/neon/test/driver.test.ts`, the same input table as
      1.2 against the WebSocket path's fake pool, plus: the HTTP overload
      declares `prepared-statements: false` and its type accepts no
      options argument (a `// @ts-expect-error` line in the test). Green:
      mirrors 1.2 in `packages/neon/src/driver.ts`; `http.ts` declares
      `false`. Files: `packages/neon/src/driver.ts`,
      `packages/neon/src/http.ts`, `packages/neon/test/driver.test.ts`.

- [ ] 1.4 (~7m) **[design]** The transaction-pooler path refuses a
      preparing base. Settles the code
      (`prepared-statements-without-session`) and the message: names the
      endpoint, states the base prepares, `Next:` line naming both
      remedies. Red: `packages/supabase/test/driver.test.ts`, new
      describe *"the transaction-pooler endpoint refuses a base that
      prepares"*, table: {`transaction-pooler` + preparing base →
      throws, code, message contains `"transaction-pooler"` and `Next:`,
      base never called}; {`transaction-pooler` + non-preparing base →
      decorated driver declares `prepared-statements: false`};
      {`session` / no endpoint + preparing base → declaration `true`
      passes through, execute reaches the base}. `pooler.test.ts`'s
      capability pin gains the third key. Green: the check sits beside
      `assertKnownEndpoint`; `pooler.ts`'s `CAPABILITIES` gains
      `"prepared-statements": false`. Files: `packages/supabase/src/
      driver.ts`, `packages/supabase/src/pooler.ts`, `packages/supabase/
      test/driver.test.ts`, `packages/supabase/test/pooler.test.ts`.

- [ ] 1.5 (~8m) Live witness on `postgres:17-alpine`. Red:
      `packages/pg/test/integration.test.ts`, new case *"a prepared
      statement is reused on its connection"*: a driver with the option
      over a single-connection pool executes one built select twice,
      then reads `pg_prepared_statements` on the same connection — one
      row whose `statement` is the text; a `sql`-kind two-command text
      (`select 1; select 2`) still runs under the option; the same
      driver without the option leaves `pg_prepared_statements` empty.
      Files: `packages/pg/test/integration.test.ts`.

- [ ] 1.6 (~6m) Docs and changeset. `skills/hejbro/references/
      query-layer.md` documents the option on `pgDriver`, the kinds that
      are named, the escape hatch that never is, no eviction, and the
      server's own generic-plan behaviour (`plan_cache_mode`);
      `supabase-preset.md`'s capability table gains the third column and
      the pooler refusal; `neon-preset.md` gains the option on the
      `Pool` path. `pnpm changeset` → `minor`. Files: the three
      references, `.changeset/*.md`.
