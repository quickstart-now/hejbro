# Work — quickstart-now/hejbro#458

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Three connecting commands never read the configuration

_2026-09-05T06:58Z_

runImport (commands/import.ts), runPull (commands/pull.ts) and runRaise
(commands/raise.ts) call loadConfig nowhere; only check, status, migrate
and reset do. loadConfig throws config-not-found when no file is present
(loader.ts). pull's connection flag is --db-url, not --url.

<a id="w2"></a>
## W2 — import, pull and raise take no --config flag

_2026-09-05T06:58Z_

Once these three read the configuration they are the only config-reading
commands with no --config flag. Out of scope for add-config-driver by
lead ruling 458/R2 item 3; harden-config-root handles it. No code here.

<a id="w3"></a>
## W3 — One unreproduced packages/cli test failure under full-suite load

_2026-09-05T08:31Z_

One TURBO_FORCE=1 pnpm test run reported 10 failures in packages/cli;
three later full runs were clean. The failing names and their failure
mode were lost: the run was piped through tail -20. Ruled out as a
cause of the code under change: no vitest config in this repo sets
pool/isolate/fileParallelism, so files run isolated per process and the
new globalThis test seams cannot cross files; the seven seam keys are
distinct and each is cleared in afterEach.

<a id="w4"></a>
## W4 — task 1.12: describe an errorevent-shaped throw, plus a pre-existing null-prototype crash

_2026-09-05T10:46Z_

Task 1.12 (review round 2) added `errorConstructorName` as the last
rung before `describeDriverError`'s final fallback, so a real
`ErrorEvent` (empty own `message`, no `code`) renders as `"ErrorEvent"`
instead of `"[object ErrorEvent]"`. The hand-made row from 1.9
(`{ message: "connection reset", type: "error" }`) never exercised the
real bug: a genuine `ErrorEvent`'s own `message` is empty, so it never
reached that row's branch at all -- kept both rows side by side, only
the real-instance row reproduces the class.

Mandatory reinforcement found by the same review: the fallback's own
last resort, `String(error)`, throws `TypeError: Cannot convert object
to primitive value` for a null-prototype object (`Object.create(null)`)
-- pre-existing, not introduced by 1.12, reachable because a user's
config-driver factory can throw anything. Confirmed red first (2 of 3
new rows failed with exactly that TypeError; the third,
`{ constructor: 1 }`, was already green since `errorConstructorName`'s
existing `typeof name !== "string"` guard already handles a
non-function `constructor` safely). Fixed by splitting the fallback:
primitives keep `String(error)`, objects use
`Object.prototype.toString.call(error)` (never throws, same
`"[object Object]"` for a plain `{}`). Rewind-verified: reverting only
the split reproduces exactly the same 2 failures, the other 11 rows
unaffected.

Two commits: d53c0a73 (constructor-name rung), 4cc5c391 (the
reinforcement). task-times.csv carries both as one row (1.12, 44m
actual vs 6m estimate) since the reinforcement was the same task
continued after review, not a separate one.

<a id="w5"></a>
## W5 — W5 — CI: cli-smoke's neon e2e failed because @hejbro/neon was never built before the test

_2026-09-05T11:34Z_

PR #909 verify (24) failed in `examples/cli-smoke/test/config-driver.e2e.test.ts` (task 1.11 case): `hejbro generate` exited 1 at the config import. The runner's `pnpm test` step built core, query, pg, supabase, nile and hejbro -- never `@hejbro/neon` -- because cli-smoke links `packages/neon` by path only and declared no workspace dependency on it, so turbo's `^build` had no edge to follow; CI runs `pnpm test` before `pnpm build`, so `packages/neon/dist` did not exist yet. Locally every worktree already carries a built neon, which is why the suite was green here. Fix: `@hejbro/neon` declared as a cli-smoke devDependency (lockfile link entry); `turbo run test --filter=cli-smoke --dry=json` now schedules `@hejbro/neon#build` before `cli-smoke#test`. Private package, no changeset. Node 22 leg was cancelled by fail-fast, same cause.

