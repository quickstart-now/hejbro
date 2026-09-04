# 2026-08-26 — ORM query-layer proposal: first OpenSpec change (D91–D98)

Refs:
- openspec/changes/add-query-layer/.openspec.yaml @ blob 701445b8918c5053f1ef1286eca58370ff4029e7
- openspec/changes/add-query-layer/proposal.md @ blob 6351dd439e008bffc040cb1dc2747deb65a6c60d
- openspec/changes/add-query-layer/design.md @ blob 383e001bfed2abb820c5bed12dc4dd7c857ea1ef
- openspec/changes/add-query-layer/tasks.md @ blob c47413ed2ef95a29eba48816b1287b216c4a224b
- openspec/changes/add-query-layer/specs/query-builder/spec.md @ blob c8682d9d8df4ce64bf4029a4f7f8c37479545f1f
- openspec/changes/add-query-layer/specs/query-type-inference/spec.md @ blob e3ed6b3f5cd3ed239ab866a036869e97386261d2
- openspec/changes/add-query-layer/specs/driver-contract/spec.md @ blob 23a384bead03ddc03071b6d467edacdbb9df86d9
- openspec/changes/add-query-layer/specs/query-execution/spec.md @ blob ec3ba541a949ece22f6b769f3e96619e835b4b92
- openspec/changes/add-query-layer/specs/rls-execution-context/spec.md @ blob 6b4b79bc8ec1e045407df8d8cfbcafb67a102ee8
- openspec/changes/add-query-layer/specs/typed-function-execution/spec.md @ blob cce8b6daf78cc731ff469915a32436bdcb4795a4
- docs/specs/2026-08-19-hejbro-design.md @ blob 4b0be05440880e3ba344370ccae04673635f8c3f

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

## Input — start the session with the rebase, then the proposal

> For the next session, let's start with `git fetch upstream && git
> rebase upstream/dev` and then go straight into `/opsx:propose` (the
> ORM spec, #293).

This executes the entry point recorded at the previous session's close:
dev push CI at `0c42b17` had already been confirmed green, so the
session opens with the sync, a worktree (`phase10-orm-spec`, issue-first
satisfied by #293), and the first OpenSpec change of the D87 process.

## Assistant response and decisions

The change's substance is not new to this session: it is the
eight-decision ledger the owner settled one decision at a time
(AskUserQuestion trail) in the ORM pivot brainstorm earlier on
2026-08-26 — ① hejbro extends as one product, ② conventional surface +
differentiators only, ③ differentiators-first with the typed `sql`
escape hatch, ④ shared ExprNode IR with a new pure statement-IR
package, ⑤ capability-declaring driver contract and the package map,
⑥ RLS execution context variant (a), ⑦ declaration-inferred types with
no codegen, ⑧ v1 cut (A) with six named deferrals. This session turned
that ledger into artifacts:

- **Change `add-query-layer`** (spec-driven schema, via `openspec new
  change` + the `/opsx:propose` workflow): proposal, design, tasks, and
  six capability delta specs — `query-builder`,
  `query-type-inference`, `driver-contract`, `query-execution`,
  `rls-execution-context`, `typed-function-execution`. The capability
  split follows the spec organization the specs directory will keep
  long-term (flat, kebab-case), one behavioral contract each.
- **Decision log rows D91–D98**, one per ledger decision, carrying the
  rationale and alternatives (this document deliberately does not
  restate them; the log is the authority). D82/D83 stay retired; the
  numbering continues from D90 as recorded in #293's body.
- **Parking issues #298–#303** (Feature, sub-issues of #282, via
  issue.sh) for the ⑧ deferrals: relational layer, CTE/window/set
  operations, `@hejbro/neon`, `@hejbro/nile`, startup verify assertion,
  prepared-statement caching.
- **Release mechanics recorded as an open question** (design.md), per
  #293's out-of-scope line: fixed-group membership and first-version
  policy for `@hejbro/query`/`@hejbro/pg` are the owner's call at the
  release gate; tasks.md pins the settlement to task 7.3 `[design]`.
- **tasks.md under D88**: 29 tasks in 7 parallel-safe groups (no file
  overlap; the `@hejbro/query` barrel file is deliberately owned by
  group 7 so groups 1–4 never touch a shared file), minute estimates on
  every line, each task naming its red test, contract-settling tasks
  marked `[design]` — including the `$type` jsonb brand task, which is
  the one place the change touches core (type-level, additive, per ⑦).

Owner approval is the PR merge (D87 gate): the PR carries the D91–D98
rows, so merging it is the decision-log approval and the proposal
approval in one act, mirroring how E3 landed D87–D89.

## Internal processing

Memory checkpoint procedure followed as written (rebase → worktree →
`dd-openspec` skill → `/opsx:propose`); dev was already at `0c42b17`
after the fetch, so the rebase was a no-op. `openspec validate
add-query-layer --strict` passes; `openspec status` reports 4/4
artifacts. Estimates are first-round — `openspec/task-times.csv` was
created empty at E3, so there is no history to calibrate against yet;
D88's overrun rule is the correction mechanism. The owner's standing
explicit-SQL rule (no `select *` / `returning *`, rejected twice in
Phase 9) is written into the query-builder and typed-function-execution
spec deltas as SHALL-level requirements rather than left as style
memory. No production code was written (the propose workflow's planning
boundary); the six parking issues were filed before this entry so their
numbers could be pinned into the proposal text.
