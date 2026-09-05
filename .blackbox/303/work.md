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

