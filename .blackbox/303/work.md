# Work — quickstart-now/hejbro#303

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — task 1.1: capability set names three keys

_2026-09-05T04:41Z_

Extended `DriverCapabilityKey` to a third key, `"prepared-statements"`
(packages/query/src/driver/contract.ts). Wrote the RED test first
(packages/query/test/driver/contract.test.ts): a declaration missing the
new key fails tsc, and naming a fourth key still fails tsc; confirmed
RED via `pnpm --filter @hejbro/query check-types` before adding the key.
GREEN: mechanically added `"prepared-statements": false` to every
`DriverCapabilities` literal across packages/*/src and packages/*/test
(40 files) via a small script, hand-reviewed the diff, then ran
`pnpm format` for the resulting line-length reflow. Full gate: root
`TURBO_FORCE=1 pnpm check-types` (18/18 tasks), `pnpm check`,
`pnpm check:bans`, and `TURBO_FORCE=1 pnpm test` (93 files / 1322 tests
+ 2 type-test packages) all green.

<a id="w2"></a>
## W2 — task 1.2: pgDriver prepares on request

_2026-09-05T04:52Z_

Added PgDriverOptions second argument to both pgDriver overloads
(pool and connection-string). preparedStatementName derives
hejbro_ + 32 hex of sha256(text) (node:crypto). makeSession/execute
sends `name` only for built kinds (select/insert/update/delete/setOp)
when the option is true; sql-kind is always unnamed. capabilities
spreads the caller's own prepared-statements over the fixed base.

RED first: packages/pg/test/driver.test.ts's new describe (14 cases
covering the input table: option x kind x params, plus determinism/
collision/63-byte/transaction-path/checkout-pin-unnamed/capabilities-
mirroring axes) against the unmodified driver.ts -- confirmed 9
failures + missing-2nd-argument tsc errors via `npx vitest run
test/driver.test.ts -t preparedStatements`. GREEN: implemented the
option; 52/52 tests pass. Avoided ternary (repo ban) by extracting
nameForQueryConfig as an if/return helper instead of a conditional
spread. Full gate green: TURBO_FORCE=1 pnpm check-types (18/18),
pnpm check, pnpm check:bans, TURBO_FORCE=1 pnpm test (all packages,
1322+52 etc. all passing, no regressions).

<a id="w3"></a>
## W3 — task 1.3: neonDriver prepares on request on its Pool path

_2026-09-05T04:58Z_

Mirrors task 1.2's pg driver shape: NeonDriverOptions second argument on
neonDriver's Pool overload only (the HTTP overload's type accepts no
options -- pinned by a @ts-expect-error test, since it has no session to
prepare in). preparedStatementName/nameForQueryConfig duplicated (not
imported) from @hejbro/pg's own copy per the provider-preset boundary
(.claude/rules/provider-preset.md forbids depending on a concrete
driver implementation). http.ts needed no code change -- its
CAPABILITIES was already a static false for prepared-statements.

RED: packages/neon/test/driver.test.ts's new describe (mirroring pg's
input table) against the unmodified driver.ts -- 8 failures via
`npx vitest run test/driver.test.ts`. GREEN: 28/28 pass after
implementing the option. Full gate green: TURBO_FORCE=1 pnpm
check-types (18/18), pnpm check, pnpm check:bans, TURBO_FORCE=1 pnpm
test (all packages passing, @hejbro/neon 53/53, no regressions).

<a id="w4"></a>
## W4 — task 1.4: transaction-pooler path refuses a preparing base

_2026-09-05T05:03Z_

supabaseDriver's "transaction-pooler" endpoint now refuses a base
driver that declares prepared-statements:true at construction, coded
prepared-statements-without-session, message naming the endpoint and
a Next: line naming both remedies (build the base without
preparedStatements, or use "session"). Checked once alongside
assertKnownEndpoint, before poolerDriver ever wraps anything -- opens
no connection, sends nothing. The session endpoint (or no endpoint)
already passed the base's declaration through unchanged (applyEndpoint
returns the base as-is), so no separate wiring was needed for that
half of the table. pooler.ts's own CAPABILITIES already carried
"prepared-statements": false from task 1.1's mechanical pass.

RED: packages/supabase/test/driver.test.ts's new describe -- 1 failure
(the refusal case) against the unmodified driver.ts, the other two
table rows already passing incidentally (regression control + session
passthrough) since nothing yet contradicted them. GREEN: 15/15 in this
file. Full gate green: TURBO_FORCE=1 pnpm check-types (18/18), pnpm
check, pnpm check:bans, TURBO_FORCE=1 pnpm test (all packages passing,
@hejbro/supabase 145/145, no regressions).

<a id="w5"></a>
## W5 — task 1.5: live witness on postgres:17-alpine

_2026-09-05T05:15Z_

Docker-gated live proof in packages/pg/test/integration.test.ts: a
fresh max:1 Pool, wrapped first by a driver without the option
(confirms pg_prepared_statements starts and stays empty across two
executions of the same built statement), then by a second driver over
the SAME physical connection with preparedStatements:true (confirms
exactly one pg_prepared_statements row after two executions of the
same text, whose statement column is that exact text), then a
sql-kind two-command text under the true declaration (confirms it
still runs -- naming it would have made Postgres reject the Parse
message with "cannot insert multiple commands into a prepared
statement"). Found along the way: node-postgres's multi-statement
simple-query result is an array of per-statement results, not a
single {rows} object -- pre-existing, unrelated to this change (no
test before this one ever inspected the return value of a
multi-statement sql execute), so the new test's own assertion only
checks resolution, not the multi-statement return shape.

Verified: `pnpm --filter @hejbro/pg test:integration` against a real
postgres:17 container -- 27/27 pass including the new case. Full
non-integration gate green too: TURBO_FORCE=1 pnpm check-types
(18/18), pnpm check, pnpm check:bans, TURBO_FORCE=1 pnpm test (all
packages passing, no regressions).

<a id="w6"></a>
## W6 — task 1.6: docs and changeset

_2026-09-05T05:24Z_

skills/hejbro/references/query-layer.md: removed the now-outdated
"Prepared-statement caching (#303) -- not supported" entry (the whole
"Not supported in this version" section, its only bullet), added a
"Prepared statements" subsection under "Building a handle" documenting
pgDriver's option, the naming rule, the escape hatch exclusion, no
eviction, and the server's own plan_cache_mode behavior.
supabase-preset.md: capability table gains the prepared-statements
column, a new "The pooler refuses a base driver that names its own
statements" section with a runnable example of the construction-time
throw, and the stale "does not change prepared-statement behavior
under the pooler" paragraph corrected (that claim predates this
change; the pooler now does read this capability).  neon-preset.md:
documents the option on neonDriver's Pool overload and that the HTTP
overload's type accepts none. One fixed-group minor changeset
(.changeset/add-prepared-statements.md) covering all seven published
packages.

Verified: pnpm --filter @hejbro/skills test (24/24 -- every ts block
on the touched pages type-checks, links.test.ts unaffected since no
new file paths were cited), pnpm changeset status (confirms all seven
packages bump minor). Full gate green: TURBO_FORCE=1 pnpm check-types
(18/18), pnpm check, pnpm check:bans, TURBO_FORCE=1 pnpm test (all
packages, no regressions). tasks.md's six checkboxes ticked.

