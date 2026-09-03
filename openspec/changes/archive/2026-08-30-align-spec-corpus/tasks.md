# Tasks: align-spec-corpus

Groups are parallel-safe slices (no file overlap). Estimates are pure
work minutes. A task that would need package-source behavior changes to
go green is a divergence tripwire — stop and escalate.

## 1. Query-layer contract confirmation and test binding

- [x] 1.1 `[design]` ~10m Confirm the on-conflict delta against the
  implementation (`packages/core/src/query/mutate.ts`,
  `packages/core/src/expr/render-sql.ts`): zero-target
  `onConflictDoNothing()` behavior and `doUpdate` set typing; adjust
  the delta's requirement text to the confirmed contract, then verify
  each of its three scenarios maps to a test in
  `packages/core/test`/`packages/query/test` (starting from whichever
  scenario lacks one as the red test) and `openspec validate
  align-spec-corpus --strict` passes.
  (Settled: zero-target measured as rendering invalid `on conflict ()`;
  owner ruled to land the `empty-conflict-target` guard here — red test
  in `mutate.test.ts` "refuses an empty conflict target", green via
  `resolveConflictTarget`. Scenario bindings: render →
  `mutate.test.ts`/`corpus.test.ts`, doUpdate params →
  `compile/mutation.test.ts`, chain equality → `db/chain.test.ts`.)
- [x] 1.2 ~8m Bind the split query-execution requirements' scenarios
  (array element conversion, arrival-shape mismatch, notNullElements,
  whole-value atomicity) to their existing tests by name; add the one
  red test for any scenario found unbound; verify with the named tests
  passing under `pnpm test`.
- [x] 1.3 `[design]` ~5m Confirm the IntervalValue delta against the
  conversion implementation and its tests (normalization example
  `14 months` → `{years: 1, months: 2}`, seven-field shape); adjust
  delta text if the confirmed behavior differs; verify the
  normalization scenario names a passing test.
- [x] 1.4 ~8m Verify the chain stage-parity list against
  `packages/query/src/db/chain.ts` (every listed stage present,
  `with()` root naming) starting from a compile-equality test case for
  a stage lacking one; verify the parity scenario's named test passes.

## 2. Seeded anchor specs bound to the CLI and preset surfaces

- [x] 2.1 ~10m Bind the `generate`/`verify` seed scenarios
  (determinism, only-the-difference, no-change exit 0, untouched chain
  passes, hand-edit mismatch) to existing tests in
  `packages/cli/test`; write the red test for any scenario found
  unbound; verify the named tests pass.
- [x] 2.2 ~8m Bind the `diagnostics` and `migration-format` seed
  scenarios (code + `Next:` format, banner prefix parsers, unknown-line
  tolerance) to existing tests; write the red test for any unbound
  scenario; verify the named tests pass.
- [x] 2.3 ~10m Write the failing `@hejbro/neon` README mode-mismatch
  test (asserts the section exists and names the deny half, the
  still-admits half, and the token-validity timing), then bring the
  README to green if the section is missing or incomplete; verify the
  new test passes and `pnpm check` stays clean.

## 3. Repo docs, config rule, and provenance

- [x] 3.1 ~6m Add the P6 recurrence rule to `openspec/config.yaml`
  (delta specs state the present contract only — no issue numbers,
  change ids, measurement labels, or renaming narratives in requirement
  or scenario text) and update the provider sentence in `AGENTS.md` and
  `README.md` (Supabase and Neon shipped, Nile planned); verify
  `openspec context` loads the config and a grep shows no
  "Neon and Nile planned" remnant.
- [x] 3.2 ~5m Refresh the two stale Purpose sections in the MAIN specs
  (`openspec/specs/cli-commands` — covers baseline and check;
  `openspec/specs/query-builder` — set operations, windows, CTEs
  included), which deltas cannot carry for existing capabilities;
  verify `openspec validate --all --strict` passes.
- [x] 3.3 ~8m Write the `blackbox/` entry for this owner-driven change
  (owner inputs as English rewrites, D1–D3 decisions, adopted P1–P18,
  internal processing), pin Refs after the change's last commit; verify
  every pin matches `git rev-parse HEAD:<path>`.
