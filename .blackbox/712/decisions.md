# Decisions — quickstart-now/hejbro#712

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-catalog-inference-2: roles from policies too (public excluded); an enum name is held to D36 and omitted with its columns

_lead · extension · basis 412/D24, D25; the requirement's own one-rule sentence for identifiers; #678's measurement (pg_policies.roles never read); #712's finding (pgEnum asserts nothing) · 2026-09-05T05:55Z · ratified: pending_

Design (design.md Q1-Q2): pg_policies.roles joins the inferred role union, `public` dropped; an enum whose catalog name D36 rejects is omitted together with every column typed by it, one report line naming both with the check consequence. catalog-inference: two MODIFIED requirements. Constructor-mode review (catalog input). Ratification: owner on return.

<a id="r2"></a>
## R2 — the omitted-enum line says check names the column and not the type; commands/check.ts joins task 1.4 for the comparator move

_lead · interpretation · basis 712/R1; delta catalog-inference 'SHALL NOT promise that check will report it where check will not'; measured: check/inventory.ts has no enum axis, cli-commands inventory requirement closed list; compareCodeUnits lives in commands/check.ts 229-254; #1006 · 2026-09-06T01:45Z · ratified: pending_

Two questions from the planner's start report, before any code.

Q1 — the omitted-enum line's `check` consequence. The delta's scenario "An omitted enum's line names its columns and what check will do" and tasks.md 1.5 said `check` keeps listing "both" the enum and its column as unmanaged. `check`'s inventory (`packages/cli/src/check/inventory.ts`; the `cli-commands` inventory requirement) names a table, and on a managed table a column, an index and a check constraint, and extensions — it has no enum axis, so it never names the type; the column typed by it is a database-only column on a managed table and is named. The delta's own requirement forbids a line that promises a report `check` will not make. Ruling: option (A), the lead's artifact error is repaired in the artifacts — the scenario's THEN and task 1.5 now say that `check` keeps naming the column until it is declared and does not name the type, and the report line says both halves in one line (import and pull variants, wording settled in task 1.2's design step). Option (B), an enum axis in `check`'s inventory, is a `cli-commands` contract change outside this delta and is filed as #1006 (fix, low priority); when it lands the line is re-worded there.

Q2 — file boundary for task 1.4. The comparator to share is `compareCodeUnits` in `packages/cli/src/commands/check.ts` (229–254), not in `check/inventory.ts`; moving it to a shared module means editing `commands/check.ts`, which tasks.md did not list. Ruling: `packages/cli/src/commands/check.ts` joins task 1.4's files for exactly the move and its import line — no assertion or logic moves with it; tasks.md's header names it. A copy in `loss-report.ts` would contradict the delta's "the same comparator, shared" and is refused.

