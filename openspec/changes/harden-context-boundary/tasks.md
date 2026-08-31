# Tasks: harden-context-boundary

## Contract-to-test map

Every added clause, the scenario that makes it testable, and the red
test the task starts from. Every added clause has a row; a row may be
driven by more than one test, and a scenario may span two rows when its
halves are pinned separately. One row is a regression pin for behavior
that already ships and adds no clause — it is marked as such. Nothing
outside this table is added.

| Added clause | Scenario | Red test |
|---|---|---|
| 1. rls: satisfaction is not vacuous — a rendering producing no statement is refused with `context-rendering-empty` | rls: A context whose rendering produces nothing is refused | `packages/query/test/db/context-required.test.ts` → `refuses a mandatory context whose contributed rendering produces no statement` |
| 2. rls: same clause's placement half — after the rendering ran, before any caller statement, the opened transaction carrying none | rls: A context whose rendering produces nothing is refused (placement half) | `packages/query/test/db/context-required.test.ts` → `sends no caller statement and leaves the opened transaction carrying none` |
| 3. rls: same clause's default-rendering instance — a context carrying neither role nor setting | rls: A context carrying nothing does not satisfy the declaration | `packages/query/test/db/context-required.test.ts` → `refuses an entirely empty context on a role-less, context-mandatory driver` |
| 4. rls: on a driver making no mandatory-context declaration, an empty rendering is still applied as given | rls: A driver that requires no context keeps applying nothing | `packages/query/test/db/context-required.test.ts` → `leaves a non-declaring driver's empty-rendering execution alone` |
| 5. rls: every refusal names the surface the caller invoked, never a construction option | rls: A refusal names the surface the caller invoked | `packages/query/test/db/context-required.test.ts` → `names the surface the caller invoked on each refusal` |
| 6. rls: same clause's chain half — one name SHALL NOT stand in for several surfaces | rls: A refusal names the surface the caller invoked (the two chain members do not share one name) | `packages/query/test/db/context-required.test.ts` → `names each chain member separately` |
| 7. rls whitelist: admission by the role check is not admission by every check — a context it admits may still be refused downstream | pinned by row 3's scenario, which is that downstream refusal | `packages/query/test/db/context-required.test.ts` → `refuses an entirely empty context on a role-less, context-mandatory driver` (row 3's test) |
| 8. driver-contract: the query layer's own missing-capability operation names the caller's surface; a driver's own names its member | driver-contract: The refusal names the surface the caller invoked | `packages/query/test/db/context-provider.test.ts` → `names the caller's surface when the capability is missing`, and `packages/query/test/db/context.test.ts` → `names the caller's surface on the scoped path` |
| 9. driver-contract: an empty rendering is not an application; the conclusion is drawn from the count alone, none inspected | driver-contract: An empty rendering is not an application of the context — this scenario spans two tests: its *refused* half is pinned by row 1's test, its *count-not-read* half by the test named here | `packages/query/test/db/context-required.test.ts` → `accepts a single unreadable statement — the layer counts, it does not read` |
| 10. *(regression pin — no added clause)* the preset's own rendering refuses a context carrying no tenant setting, so the preset never reaches the query layer's new refusal | shipped: rls "The Nile rendering constrains the values it interpolates" | `packages/nile/test/context.test.ts` → `refuses a context carrying no tenant setting before producing a statement` |

**Check 1 — subject match.** Rows 1-4, 7, 9 and 10 have the *execution*
as their subject, and each red test drives an execution through the
public `db()` handle (or, for row 10, through the preset's own
rendering as the preset's suite already does), never through
`applyContext` or a private helper. Rows 5, 6 and 8 have the *error a
refusal carries* as their subject, and each red test reads the thrown
error's own operation. No row carries two subjects.

**Check 2 — which universal each addition belongs to.** Rows 1-4, 7 and
9 are instances of the existing universal "every execution surface of a
handle built on it … SHALL refuse to run uncontexted": they add *when
the requirement counts as satisfied*, not a new surface, so the four
**categories** the requirement enumerates (statement execution, chain
member, declared-function call, transaction API) are unchanged and no
count moves. Rows 5, 6 and 8 read that same enumeration from the error's
side, where the categories map to the **eight names** a refusal may
carry — `db.execute`, `db.select`, `db.insert`, `db.update`,
`db.deleteFrom`, `db.with`, `db.fn`, `transaction`, the list the skill
already publishes — and adding a name would require adding a surface
first. The requirement's "spelled as the caller spells it" is what
carries four categories onto eight names, so no count lives in the spec
that this change would have to move. Row 10 belongs to the preset's own
value-constraint requirement and moves no count at all.

## Delegated rules read

The delta names a coded error but does not restate the diagnostic
format, because `diagnostics` owns it. Read in full before writing the
thrower — `openspec/specs/diagnostics/spec.md`, "Every hejbro diagnostic
carries a code and a Next line": "Every user-facing hejbro failure … SHALL
carry a stable, kebab-case hejbro error code … and an actionable `Next:`
line naming what the user can do about it. The code is the
machine-readable identity: it SHALL stay stable across releases while
message prose MAY change, and a consumer branching on a failure SHALL be
able to branch on the code alone." Two consequences bind the tasks
below: the new code's message carries a literal `Next:` line (also gated
by `pnpm check:next-marker`, which scans `packages/query/src`), and the
`operation` token is prose, so changing it is not a code change.

## 1. Query-layer boundary (issue #590)

est_frozen: 56m. Files: `packages/query/src/db/context.ts`,
`packages/query/src/db/db.ts`, `packages/query/src/db/chain.ts`,
`packages/query/src/db/fn.ts`, `packages/query/src/db/transaction.ts`,
`packages/query/test/db/context.test.ts`,
`packages/query/test/db/context-provider.test.ts`,
`packages/query/test/db/context-required.test.ts`,
`packages/query/test/db/chain.test.ts`.

Order matters inside this group: 1.5 settles the run factory's shape, so
1.6 and 1.7 name their surfaces against a signature that is already
fixed rather than reworking one.

- [ ] 1.1 [design] Add the `context-rendering-empty` thrower to
  `context.ts`: code fixed by ruling, message states the observation only
  ("the rendering in effect produced no statement for this context; a
  mandatory context that applies nothing is not applied") and ends in a
  `Next:` line naming only remedies in the caller's hands (fill the
  context with what the platform requires, or use a driver that does not
  require one). ~6m. Red:
  `packages/query/test/db/context-required.test.ts` →
  `refuses a mandatory context whose contributed rendering produces no statement`
  (asserts `code` only). Files: `context.ts`, `context-required.test.ts`.
- [ ] 1.2 Refuse in the apply path where — and only where — the driver
  declares a context mandatory: count the rendering's output after it
  runs, before any caller statement is sent. ~7m. Red: same file →
  `sends no caller statement and leaves the opened transaction carrying none`.
  Files: `context.ts`, `context-required.test.ts`.
- [ ] 1.3 Cover the default-rendering instance: an entirely empty context
  on a driver declaring both a mandatory context and a role-less
  platform. ~6m. Red: same file →
  `refuses an entirely empty context on a role-less, context-mandatory driver`.
  Files: `context.ts`, `context-required.test.ts`.
- [ ] 1.4 Pin the two negatives the rule must not overreach into: a
  driver that makes no mandatory-context declaration still runs an
  empty-rendering execution, and a rendering returning one unreadable
  statement is accepted (the layer counts, it never inspects). ~8m. Red:
  same file → `leaves a non-declaring driver's empty-rendering execution alone`
  and `accepts a single unreadable statement — the layer counts, it does not read`.
  Files: `context.ts`, `context-required.test.ts`.
- [ ] 1.5 [design] Make `createChainApi` take a per-member run factory
  instead of one shared run, and update its three call sites (`db.ts`,
  `context.ts`, `transaction.ts` — the last passes the session straight
  through and gains no token), so a chain member's own name reaches the
  refusal it produces. ~8m. Red:
  `packages/query/test/db/context-required.test.ts` →
  `names each chain member separately`. Files: `chain.ts`, `db.ts`,
  `context.ts`, `transaction.ts`, `context-required.test.ts`.
- [ ] 1.6 [design] Per-verb operation tokens on the explicitly scoped
  path: replace the three shared `"db.as"` literals in `context.ts` with
  the caller's own surface names (`db.execute`, the chain member's own
  name, `db.fn`; `transaction` unchanged). ~7m. Red:
  `packages/query/test/db/context.test.ts` →
  `names the caller's surface on the scoped path`. Files: `context.ts`,
  `context.test.ts`.
- [ ] 1.7 [design] Per-verb tokens on the provider path: retire
  `PROVIDER_OPERATION` in `db.ts` and give `execute` and `fn` their own
  names. ~8m. Red:
  `packages/query/test/db/context-required.test.ts` →
  `names the surface the caller invoked on each refusal`, and
  `packages/query/test/db/context-provider.test.ts` →
  `names the caller's surface when the capability is missing`. Files:
  `db.ts`, `fn.ts`, `context-required.test.ts`,
  `context-provider.test.ts`.
- [ ] 1.8 Repair the comments that now say more than the code does: the
  `db.ts` doc comment claiming the operation "names the surface that was
  refused, the same way `driver-missing-capability`'s own message does"
  (true only after 1.5-1.7, and its comparison was never true), and the
  test comments in `chain.test.ts` and `context-provider.test.ts` that
  describe the old single-run signature. Comments state the constraint
  only. ~6m. Red: none — comment-only; guarded by `pnpm check` and the
  suites the earlier tasks left green. Files: `db.ts`,
  `packages/query/test/db/chain.test.ts`, `context-provider.test.ts`.

## 2. Preset regression, user documentation, release artifacts (issue #591)

est_frozen: 26m. Files: `packages/nile/test/context.test.ts`,
`skills/hejbro/references/query-layer.md`,
`.changeset/harden-context-boundary.md`, `openspec/task-times.csv`,
`README.md`.

- [ ] 2.1 Pin the preset defense that exists but is unspecified: a
  context carrying no tenant setting is refused by the preset's own
  rendering before any statement is produced, so the preset never
  reaches the query layer's new refusal. ~6m. Red:
  `packages/nile/test/context.test.ts` →
  `refuses a context carrying no tenant setting before producing a statement`.
  Files: `packages/nile/test/context.test.ts`.
- [ ] 2.2 Rewrite the skill where it promises the old behavior: the
  boundary-cases paragraph (an empty rendering and `db.as({})` are no
  longer "worth knowing" boundaries but refusals on a context-mandatory
  driver), the `context-required` description, and a new error-table row
  for `context-rendering-empty`. ~8m. Red: none — documentation; the
  claim it makes is the one tasks 1.1-1.4 left green. Files:
  `skills/hejbro/references/query-layer.md`.
- [ ] 2.3 Update the skill's `driver-missing-capability` row, whose
  operation examples (`a transaction, a db.as context`) name the old
  vocabulary, and the "Writing your own `Driver`" note that tells driver
  authors which token to pass. ~6m. Red: none — documentation. Files:
  `skills/hejbro/references/query-layer.md`.
- [ ] 2.4 Add the `minor` changeset naming the new refusal and the
  operation renaming, write one `openspec/task-times.csv` row per task
  above, and re-stamp both README blocks in the same commit — the
  task-time badges (`pnpm check:tasktime`) and the CRAP block
  (`TURBO_FORCE=1 pnpm check:crap`, run after group 1's code is
  committed, since the new named function moves it and CI blocks on
  `git diff --exit-code README.md` in a single matrix leg). ~6m. Red:
  none — release artifacts; those two commands are the gate. Files:
  `.changeset/harden-context-boundary.md`, `openspec/task-times.csv`,
  `README.md`.
