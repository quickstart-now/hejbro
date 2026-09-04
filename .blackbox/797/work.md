# Work — quickstart-now/hejbro#797

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — reset cycle advice covers a cycle of any length

_2026-09-04T13:31Z_

`kindHasCycle` in `packages/cli/src/apply/reset.ts` replaced the old direct-mutual-edge check with a recursive topological peel (`peelHasCycle`): from the in-set edge map (self-edges and out-of-plan edges already filtered), repeatedly remove every identity whose remaining dependencies are all already removed; a non-empty remainder that removes nothing is a cycle. `declaredCycleAdvice`'s wording changed from "your own declared objects include a pair that reference each other" to "a set of your declared tables that reference each other in a cycle" — the detail-first ordering and the outside-declarations clause are unchanged.

Input table covered in `apply-reset.test.ts` (all seven rows, observed through `applyReset` with a fake driver throwing `2BP01`, matching how the three pre-existing rows already observed it): a 2-cycle (regression pin), a 3-cycle, a 4-cycle, a self-referencing table alone (no advice — the peel removes it vacuously since its only edge is filtered as self-referencing), two independent 2-cycles (advice), an acyclic chain of three tables (no advice), and a 3-cycle plus one acyclic table hanging off it (advice). `buildCycleSnapshot` was parameterized on the table names to ring (`["left_t", "right_t"]` reproduces the three pre-existing callers); a self-reference, disjoint-cycle, and acyclic-chain shape each got a small dedicated builder.

Live witness (`apply-reset.integration.test.ts`): a genuine three-table cycle (`cyc3.t_a -> t_b -> t_c -> t_a`, column-level `.references(() => ...)`) was migrated successfully, then `reset --confirm-drop` measured to fail with `error[reset-drop-failed]`, code `(2BP01)`, and the new wording ("your declared tables" ... "in a cycle") present; all three tables still stood afterward, and `status` still reported the migration applied. The four-table-loop and two-disjoint-2-cycle shapes were exercised at the unit level only (docker time budget); their peel logic is identical to the three-table case already witnessed live.

Commits: c268e0a2 (detector + wording + unit input table), e9a336f5 (live witness).

