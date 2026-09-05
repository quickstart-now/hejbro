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

