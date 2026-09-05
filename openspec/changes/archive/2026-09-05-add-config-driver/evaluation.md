# D106 evaluation — add-config-driver (round 1)

reviewer: context-free session, model fable
date: 2026-09-05
inputs read: `openspec show add-config-driver --diff`, the public exports of
`hejbro` / `@hejbro/pg` / `@hejbro/neon` / `@hejbro/nile`, `skills/hejbro/`,
`.changeset/add-config-driver.md`, and the built `packages/cli/dist/cli.js`
(commit 8b6258c5). Nothing under `proposal.md`, `design.md`, `tasks.md`,
`.blackbox/`, or implementation/test source was read.

## Method

Every scenario was run against the built CLI as a child process from a
throw-away project (`/private/tmp/d106-cd/rows/<row>/`, `node_modules/hejbro`
→ `packages/cli`, `@hejbro/*` → the worktree packages, `pg` and
`@neondatabase/serverless` → the packages' own copies). No database exists:
the factory returns a recording driver (every `execute`, `transaction`,
`client.end` call appended to a file), and a Node `registerHooks` resolve
hook records every `@hejbro/pg` import and, on demand, makes the package
unresolvable. "As before" rows were compared byte-for-byte (stdout, stderr,
exit code; PID normalised) against the parent commit 99b9554d built from
`git archive` into `/private/tmp/d106-cd/prev`.

161 distinct rows, ~167 CLI executions, plus one in-process member probe over
the eight shipped driver constructions. Axes:

- command: all seven — `check`, `status`, `migrate`, `raise`, `reset`,
  `import`, `pull` (each with its own flag; `--db-url` for `pull`)
- `driver` value: sync factory / async factory / absent / explicit
  `undefined` / string / `{}` / `null` / number / class / zero-arg arrow
- factory outcome: returns recording driver / throws `Error`, string,
  null-prototype object, ErrorEvent-shaped object, `undefined`, number,
  `AggregateError`, coded `Error` / async rejection / returns `null`,
  `undefined`, `{}`, string / returns a driver with no `client`, `client`
  without `end`, `end` not a function, `client: null`, `client: "pool"`,
  `end` that rejects / driver whose `execute` throws on the probe / on the
  third statement
- connection string source: flag only / `DATABASE_URL` only / both / neither
- configuration file: present with factory / present without / absent /
  present but failing to load (parse error) / present with invalid `driver`
- `@hejbro/pg`: resolvable / unresolvable
- shipped drivers as the factory's return: `pgDriver(url)`, `pgDriver(pool)`,
  `neonDriver(pool)`, `neonDriver(neon(url))`, `supabaseDriver(pgDriver(url))`
  session and `transaction-pooler`, `nileDriver(pgDriver(url))`,
  `nileDriver(neonDriver(neon(url)))`, plus the Supabase and Nile decorators
  over the recording driver
- type surface: `defineConfig` accepts the four documented factory shapes
  (sync/async, pg/neon/supabase) and rejects a string and a driver instance
  (`tsc --strict`, `@ts-expect-error` both fire)

## Blocking findings

### B1. "No factory, no change" is not byte-for-byte for `pull`

Scenario *No factory, no change* — "every connecting command imports the
vanilla driver on demand and behaves byte-for-byte as before". Six commands
do (stdout, stderr, exit identical to the parent build for both the
connection-refused and the `@hejbro/pg`-absent paths). `pull` does not: its
two connection diagnostics now name `--db-url` where the parent build named
`--url`.

Reproduce (project with a `hejbro.config.ts` that sets no `driver`, or none
at all — both differ the same way):

```
$ hejbro pull --schema app --db-url postgres://u:p@127.0.0.1:1/dbx
now : error[pull-connection-failed]: hejbro pull
        hejbro pull could not connect to the database: connect ECONNREFUSED 127.0.0.1:1. Next: confirm --db-url/DATABASE_URL is correct and the database is reachable, then rerun `hejbro pull`.
prev: ...  Next: confirm --url/DATABASE_URL is correct and the database is reachable, then rerun `hejbro pull`.

$ hejbro pull --schema app            # neither flag nor DATABASE_URL
now : ... but neither --db-url nor the DATABASE_URL environment variable is set. Next: pass --db-url <connection-string>, or set DATABASE_URL, ...
prev: ... but neither --url nor the DATABASE_URL environment variable is set. Next: pass --url <connection-string>, or set DATABASE_URL, ...
```

The new text is the correct one — `pull`'s flag *is* `--db-url`, and the
ADDED requirement's own scenario ("with neither set the command fails naming
both ways") can only be satisfied by naming `--db-url`. So the delta is
internally inconsistent for `pull`: the ADDED requirement demands the change
that the "byte-for-byte" scenario forbids. The shipped behaviour follows the
ADDED requirement. The smallest remedy is spec text, not code: carve the
`pull` hint correction out of *No factory, no change* (e.g. "…as before,
except that `pull`'s two connection diagnostics now name its own `--db-url`
flag where they previously named `--url`") so the scenario sentence and the
shipped output agree and the fix is recorded rather than hidden.

## Non-blocking findings

1. **The error subject differs by command for the same failure.** The token
   after `error[code]:` is `driver` for `check`/`import`/`pull` but
   `hejbro <cmd>` for `status`/`migrate`/`raise`/`reset` on
   `invalid-config`, `*-connection-failed` (factory threw) and
   `*-driver-unclosable`; for `config-load-failed` it is `hejbro.config.ts`
   vs `hejbro <cmd>`. Reproduce: `driver: "pg"` then `hejbro check --url x`
   (→ `error[invalid-config]: driver`) vs `hejbro status --url x`
   (→ `error[invalid-config]: hejbro status`). The delta is silent on the
   subject, and the split mirrors the pre-existing `*-driver-missing`
   subjects (`@hejbro/pg` vs `hejbro <cmd>`), so this is inherited shape, but
   the new field makes the same message land in two shapes depending on
   which command the user happened to run.
2. **A `client.end` that rejects escapes uncoded.** Factory returns a driver
   whose `client.end` throws after the work: `check` prints a raw
   `Error: end failed` stack trace (frames into `cli.js`), exit 1, no
   `error[...]` code, no `Next:`. Every other failure on this path is
   coded. The delta says "closes the driver afterwards" and nothing about a
   close that fails; a pool whose `end()` rejects is a plausible real-world
   case (already-ended pool).
3. **A factory that returns a non-driver is reported as "unclosable".**
   `driver: () => null` (also `undefined`, `{}`, `"postgres://x"`) →
   `error[check-driver-unclosable]: … has no "client.end" to close it`.
   Literally true, but the user's mistake is "did not return a driver", and
   the `Next:` ("return a driver whose client.end closes the connection")
   sends them to add a member to `null`. The delta's refusal scenario is
   written for "a contract driver with no closing member", so this is the
   neighbouring input, not a contradiction.
4. **Probe failure under a configured factory points at the URL, not the
   factory.** Driver whose `execute` throws on the `select 1` probe →
   `error[check-connection-failed]: hejbro check … Next: confirm
   --url/DATABASE_URL is correct…`. When the *factory* throws, the same code's
   `Next:` names `hejbro.config.ts`'s "driver" field. The two failures are
   one user story (my configured driver cannot connect) with two different
   pieces of advice depending on whether the pool failed at construction or
   at first use. The driver *is* closed in this path (`end` recorded once).
5. **Neon WebSocket pool against an unreachable host reads "ErrorEvent".**
   `driver: (url) => neonDriver(new Pool({ connectionString: url }))`,
   `hejbro check --url postgres://u:p@127.0.0.1:1/dbx` →
   `could not connect to the database: ErrorEvent.` The description is the
   constructor name — the ErrorEvent's `message` is empty. New surface (the
   CLI could not be handed a Neon driver before this change). The
   ErrorEvent-*shaped* object with a `message` renders fine (`event-like
   msg`), so it is the empty-message case specifically.
6. **Flag validation precedes configuration validation.** `driver: "pg"`
   plus `hejbro raise --url x` without `--file` → `raise-file-missing`, not
   `invalid-config`; same for `import` without `--schema`. Scenario *The
   field is validated* says loading fails "before any command work". With
   complete flags it does (no connection, no `@hejbro/pg` import, in all
   seven commands); whether argument checking counts as "command work" is
   what the sentence leaves open.
7. **`driver: undefined` (explicit) is accepted as absent.** The requirement
   says the loader "SHALL accept a function and nothing else for the field";
   an explicit `undefined` takes the vanilla path (pg imported, connection
   attempted). This is the normal TypeScript optional-field reading and is
   almost certainly intended; noting only that the sentence, read literally,
   says otherwise.
8. **Skill discoverability.** `skills/hejbro/SKILL.md` rule 7 lists the
   connecting commands and their `--url`/`DATABASE_URL` resolution but never
   mentions the `driver` field; the field is documented only inside the
   three preset references and `brownfield-adoption.md`. An agent reading
   the top-level rules alone would still reach for `@hejbro/pg`. The
   preset references themselves match the observed behaviour exactly
   (`client.end` as the member, the HTTP driver's documented no-op `end`,
   `migrate`/`raise`/`reset` refusing the HTTP path by capability).

## Scenarios verified

| Scenario | Rows | Result |
|---|---|---|
| Each connecting command uses the configured factory | 7 cmds × {sync, async} = 14 | PASS — factory called exactly once with the flag's string; every statement (including `raise`'s transaction) reached the recording driver; `end` recorded once; zero `@hejbro/pg` imports |
| A command that never read the configuration still runs without one | `import`/`pull`/`raise` × {no config, parse-error config, `driver: "pg"`} = 9 (+12 for the other four as neighbours) | PASS — no config: identical to the parent build (except B1 for `pull`); failing config: `config-load-failed` / `invalid-config`, factory never called, nothing sent, pg never imported |
| The environment names the database for the factory too | 7 × {env only, neither, both} = 21 | PASS — env string reaches the factory; neither → `*-connection-missing` naming the flag and `DATABASE_URL`, factory not called; both → flag wins |
| A throwing factory is a failed connection | 7 × `Error` + `check` × 8 throw shapes (string, null-proto, ErrorEvent-shaped, `undefined`, number, `AggregateError`, coded, async rejection) = 15 | PASS — `<cmd>-connection-failed`, message carries the thrown value's description, ends with a `Next:` line, zero statements |
| A driver that cannot be closed is refused | 7 × no `client` + `check` × 4 shapes = 11 | PASS — `<family>-driver-unclosable`, names `hejbro.config.ts`'s "driver" field and `client.end`, zero statements |
| No factory, no change | 7 × {pg present, pg absent} vs parent build = 14 (+2 for `pull` with neither URL) | **FAIL for `pull`** (B1); PASS for the other six — byte-identical, `@hejbro/pg` imported exactly once, `*-driver-missing` identical |
| A decorated driver reaches the commands | Supabase `transaction-pooler` over the recording driver × {check, migrate, raise}; session decorator over a no-transaction base × {migrate, raise, reset, check, status}; 8 shipped constructions × {check, migrate} | PASS — `check`'s statements arrive wrapped `BEGIN` / `set local intervalstyle` / `set local bytea_output` / … (16 transactions for 16 reads); `migrate`/`raise` admitted with the decorator's own `interactive-transactions: true`; refused with `apply-missing-capability` when the base declares `false`; every shipped construction exposes `client.end` (in-process probe) and none was refused as unclosable |
| The field is validated | `check` × {string, `{}`, `null`, number, class} + 7 cmds × string = 12 | PASS — `invalid-config` names `driver` and the full shape hint including `driver?: (connectionString: string) => Driver`, before any connection or `@hejbro/pg` import (see NB6 for the flag-order nuance) |
| MODIFIED: Declarations can be checked against a live database (driver paragraph) | covered by the rows above for `check` | PASS — configured factory first; otherwise vanilla import on demand with `check-driver-missing` naming `@hejbro/pg` |

Neighbour rows not tied to a scenario (all recorded in the findings above):
`end` rejects, `execute` throws mid-command (driver still closed), probe
throws (driver still closed), factory returns non-driver, explicit
`undefined`, zero-arg arrow, flag-vs-config validation order.

## Verdict

**BLOCKED** — one blocking finding (B1), spec-text in nature: the delta's
*No factory, no change* scenario claims byte-for-byte parity while its own
ADDED requirement forces `pull`'s connection hints to name `--db-url`; the
shipped CLI follows the requirement. Amend the scenario sentence to record
the `pull` hint correction (no code change indicated) and re-run the two
`pull` parity rows; every other scenario passed on every row. The eight
non-blocking findings are follow-up candidates, none of them contradicting a
delta sentence.
