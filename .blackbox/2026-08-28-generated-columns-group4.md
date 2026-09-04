Refs:
- packages/pg/test/integration.test.ts @ blob faf628d48328b027ca5b68aab4624602b0fedd2a

# generated-columns group 4 — the real server signs off on group 2's ordering

Piece record for `add-generated-columns` task 4.1 (tracking #388),
built by the gc4 piece team (planner opus / implementer sonnet /
reviewer opus) in worktree `gen-g4-witness` off dev `90a75b4`, verdict
PASS at `a129a203fb15658d0fd66913552e23fd33a5a4e6`, rebased
blob-identical onto `d453d78`. One file, +323/−7, three commits — all
follow-up commits, zero amends.

## What landed

The docker-postgres:17 harness gains `seq` (identity always) and
`doubled` (stored generated, `amount * 2`) on the roundtrip table:
create-path grammar pinned as core's own emit output (hand-literal
shared constants interpolated into the raw DDL AND asserted against
`generateMigration` via `toContain` — the array-ergonomics precedent),
identity arriving 1n/2n, the computed column arriving
18014398509481986n (9007199254740993n × 2 — past MAX_SAFE_INTEGER, so
the bigint round-trip rides along), and both ALWAYS write arms
rejected BY THE DATABASE with measured SQLSTATE 428C9; the type-level
rejection pinned by `@ts-expect-error` through the chain API. A second
`it` witnesses the two ordering rules group 2 derived but could not
measure: the four alter statements are DERIVED from core's own emit
(a three-step snapshot chain plain→identity→plain), pinned with
`toContain` + index-order assertions, and the same strings run live —
forward succeeds, reversed fails (55000/42601, measured). **Group 2's
diff ordering is now witnessed against a real server, and its
justification is bound to the exact statements core emits.** The
reviewer independently re-derived both verdicts through psql.

## Findings

- **#390, filed mid-piece**: the ALWAYS-key exclusion lives only in
  `@hejbro/query`'s `InsertInput`; core's raw `insert()` takes
  `MutationRow` (every column optional), so the unguarded path
  compiles and dies at runtime 428C9. Found when a draft
  `@ts-expect-error` on the core path failed as an unused directive.
- **The shared-constant design closes its own hole**: `toContain`
  alone cannot catch constant SHRINKAGE (a prefix still matches), but
  the same constant feeds the raw DDL, so shrinking it breaks the
  runtime — measured during mutation review. Worth keeping as the
  rationale for the one-shared-constant rule.
- **Flake, unexplained and unreproduced**: one "Connection terminated
  unexpectedly" in the implementer's five runs; zero in the
  reviewer's sixteen; the reviewer's own `pg_isready`-false-green
  hypothesis was REJECTED by sixteen atomic probes. Recorded here (no
  issue — no mechanism, local-only harness, 0/16 reproduction);
  re-open if it recurs.
- The second `it` depends on the first's schema — a kill in the
  first cascades into two visible failures (commented in-file).

## Verdict strength

Eleven mutations, eleven kills, gate-attributed: dropping the
identity/generated clause from the DDL lets the forbidden write REACH
THE DATABASE and succeed — live proof that 428C9 is the server
speaking, not the client; option drift (`start with 100`,
`amount * 3`) kills the arrival assertions; removing
`@ts-expect-error`/`as never` dies under check-types (TS2353). Red
was established by the reviewer's independent reproduction (the
implementer self-reported post-hoc observation). Gates all Cached: 0
at baseline values, integration five clean runs.

## Process record

Two incidents, both rooted in self-directed reversals during message
crossings: the implementer started in a different shape without
acking TERMINAL v1, and later self-discarded a submitted, verified
build (297 uncommitted lines, unrecoverable) while a stay order was
in flight. The salvage: TERMINAL v1.2 kept the briefed roundtrip
shape but recovered the discarded build's superior emit-derived §4
design. Standing rules adopted: TERMINAL ack gates red; no
self-discard of submissions (disagreement escalates, never reverts);
commit per semantic unit. The lead's tautology guard (hand-literal
constants, never runtime-derived from emit) and the planner's
"everything the implementer must follow lives in the TERMINAL"
principle both landed mid-piece. Ledger: est 15m → 85m pure + 30m
process; the incident-free counterfactual is ~45–55m (the first
submission was at that level). Tokens 527 requests / 512,097 output /
97.7% cache.
