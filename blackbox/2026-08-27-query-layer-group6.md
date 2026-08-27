Refs:
- packages/supabase/src/driver.ts @ blob 01f166a206ef74e44a281b9309db40f3cbf8c601
- packages/supabase/src/context.ts @ blob 7b44e8a30ab6b59f23a5075bbe15a7fb1f9029b2
- packages/supabase/src/index.ts @ blob 3b58656354de3977583bb715388d4b3f7282d5da
- openspec/changes/add-query-layer/specs/rls-execution-context/spec.md @ blob 53c7f5d12a0346ac538c84feaffb8078cdd786b1
- .claude/rules/supabase-preset.md @ blob ebfc35edcf359b0072cc40a234c7b472182083f1
- .changeset/config.json @ blob 42df85d29497dfd3f415589efe061a2ceaef891d
- openspec/changes/add-query-layer/tasks.md @ blob f755f299944093e99724aa0f01920cd665360f68

# add-query-layer group 6 — Supabase driver decorator + RLS context surface

Piece team g6 (planner opus, implementer sonnet, reviewer opus; team-up
v2), worktree `query-g6-supabase` off dev `1caad14`, 9 team commits plus
this close-out. All [design] decisions were owner-settled before
summoning (see `2026-08-27-query-layer-g5g6-replan.md`); zero decision
waits occurred during implementation. The lead relayed rulings between
the two parallel pieces throughout; every substantive item below is
sourced from planner reports and reviewer measurements.

## What landed

`supabaseDriver(driver)` — a decorator over any contract `Driver`
adding `contributedRoles: [anon, authenticated, service_role]` and
passing every other member through; it never imports `@hejbro/pg`
(runtime dependency graph measured three ways: package.json, transitive
closure, import graph — the only `@hejbro/query` imports are
`import type`). `asUser(claims)` / `asAnon()` build contexts with the
role fixed and exactly one setting, `request.jwt.claims` (claims JSON
merged with the fixed role); verification is delegated to the app's
auth layer by design — no raw-token surface exists. Real-stack RLS
integration (local `supabase start`): a declared `authUid()` policy
filtered rows per `asUser` claims' sub, `asAnon` saw none; the harness
hand-builds a minimal contract Driver over `pg.Pool` inside the test,
which doubles as proof that the decorator accepts any conforming
driver. Spec delta scenarios were corrected from `asUser(jwt)` to
`asUser(claims)`; the preset-boundary rule now counts a driver as the
fifth preset contribution (D95).

## Incidents and their mechanics (all empirically pinned)

- **Cross-worktree turbo cache contamination.** g6's first baseline run
  was 12/12 cache replays whose logs originated in g5's worktree — the
  shared `.turbo/cache` lives in the main checkout (g5's reviewer later
  pinned the actual tar by hash). `--force` protects only the read
  side; writes still feed other teams' false greens. Standard adopted
  session-wide: `TURBO_CACHE_DIR="$PWD/.turbo/cache-<tag>"` (inside the
  already-gitignored `.turbo/`, after g6 caught that a bare
  `.turbo-cache` name would dirty `git status --porcelain` and could
  ride into commits). This is the second face of #102: isolating
  worktrees does not isolate their cache.
- **`changeset status` structurally red from `47aac29`** (the commit
  adding the runtime dependency on private `@hejbro/query`): "Invalid
  tree: @hejbro/supabase depends on the skipped package". The
  implementer refused to guess-fix and escalated; the reviewer
  falsified its own earlier claim ("status passes") and bisected the
  red to the exact commit. The lead reproduced the failure in a
  scratch worktree and measured the fix:
  `"privatePackages": { "version": true, "tag": false }` flips status
  to exit 0 (changeset v3.0.1). Ruled as moving the alarm to an honest
  place, not silencing it — the config stops *version-skipping* a
  depended-on package, while the publish-breakage alarm lives on the
  Version Packages PR (#289 hold comment) and fixed-group
  membership/first-version stay owner-gated at task 7.3. Known side
  effect, recorded: every private package now enters versioning
  (Version-PR churn only, nothing publishes). The gate itself proved
  the 7.3 constraint: query's fixed-group inclusion is mandatory, not
  optional.
- **`mergeConfig` concatenates arrays.** The integration config
  inherited the base exclude by concat and green-ran the *unit* suite
  — "green that collected the wrong thing". Fixed with object-spread
  override; propagated to g5. Registered as the fourth face of the
  piece's false-green taxonomy.
- **`pool.end()` double call** in the integration harness's failure
  path buried the guidance message under a second error — self-caught,
  fixed by removing the redundant end.

## False-green taxonomy (five faces, all observed live this piece)

1. green that never ran (turbo cache replay), 2. green that collected
nothing (`passWithNoTests` — one line flips exit 1 to 0, measured), 3.
green that verified nothing (a dead `@ts-expect-error` — liveness
proven via TS2578 when the error was satisfied), 4. green that
collected the wrong thing (mergeConfig concat), 5. green from a
mutation that was never applied (the instrument lying — g5's find,
adopted here as the 3-step validity protocol before any "survived"
verdict). Common pathology: a declaration diverging from the effective
value. Two reviewer instruments carry to 7.x: `vitest list
--filesOnly` disjointness checks, and effective-config dumps.

## Verification highlights

Nine mutations across both batches, all killed by exactly the intended
tests; `contributedRoles: []` killing 6.3 proved a first-run-green test
was not vacuous, and after strengthening, M1/M2/M5 reach 6.3 because it
asserts the actual SQL and params that hit the driver (`set local role
"anon"`, serialized claims JSON in `set_config` params) — spread order
is pinned at the wire level. CRAP non-regression was judged against a
frozen baseline snapshot (new functions only, 1.00–2.00, nothing
existing moved, no functions vanished). The final gates all ran with
the isolated cache and `--force`, `Cached: 0` cited.

## Process notes

Estimates: 46m → 91m pure. 6.2/6.5 in the calibration band; 6.1/6.3
overruns are deliberate strengthening later proven live by mutations
(scope addition, not mis-estimation); 6.4's 3.5× is the cost of
proving wiring works (two real bugs found), a lesson for future
integration-task estimates. The planner self-registered one planning
gap: `changeset status` belonged in batch A's judgment list (the red
sat unseen from 6.2 until 6.5). The task list kept 6.5 unticked while
its verification condition was red — ticked only after the delegated
config line landed. The reviewer's two self-corrections both moved
against its own prior claims via measurement (bisect; tool-defect vs
code-defect separation in a CRAP diff false alarm).
