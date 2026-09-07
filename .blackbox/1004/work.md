# Work — quickstart-now/hejbro#1004

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — refuse two carried tables of one SQL name at emission

_2026-09-07T14:24Z · per R1_

Lead-direct, three tasks (est 23 min, actual 34). `packages/cli/src/contract/name-collision.ts` groups the computed tables by SQL name exactly as carried, lists each colliding name with its schema-qualified tables in identity order, and throws `vendor-table-name-collision` (git origin) or `pull-table-name-collision` (database origin) with the command's own `Next:`; `emitContract` calls it after `computeTables` and before any rendering, so both commands refuse before writing. Red table `contract-name-collision.test.ts` (4 colliding layouts x 2 origins + unique-name layout per origin + cross-name order, 11 cases) found two facts before green: the DSL refuses a mixed-case table name (`invalid-sql-name`), so the delta's case scenario was unreachable and dropped, and contract keys render quoted. Mutations: grouping by qualified name turned 9 colliding rows green (test red), first-seen order reddened the 6 identity-order rows. CLI case in `vendor.test.ts`: exit 1, code and both qualified names on stderr, no `.hejbro/vendor/` and no lock afterwards (9/9). Gates at a716550d, serial: `TURBO_FORCE=1 pnpm check` 0, `check-types` 0, `test` 0 (189s), `check:pr-changeset` 0, `check:modified-titles` 0, `openspec validate --strict` 0, `check:blackbox` 0; `check:crap` ok, `check:tasktime` badges rewritten, `check:diagnostic-xref` and `check:next-marker` ok. Reference paragraph in `polyrepo.md`, one `patch` changeset, three ledger rows.

