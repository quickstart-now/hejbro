# Work — quickstart-now/hejbro#293

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — 2026-08-26 — ORM query-layer proposal: first OpenSpec change (D91–D98)

_2026-08-26T00:00Z_

Session: Claude Code (Fable 5), 2026-08-26. Owner inputs are English
rewrites of Korean originals.

---

### Assistant response and decisions

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

### Internal processing

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

Migrated from the single-file entry `.blackbox/2026-08-26-orm-query-layer-proposal.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-26-orm-query-layer-proposal.md`.

<a id="w2"></a>
## W2 — 2026-08-26 — add-query-layer group 1: one vocabulary, D94 amended

_2026-08-26T00:00Z_

Session: Claude Code (Fable 5), 2026-08-26 — same session as the
proposal entry (PR #304). Owner inputs are English rewrites of Korean
originals.

---

### What was built (group 1)

- Task 1.1: `packages/query` scaffold (private until task 7.3 settles
  release mechanics; no build script until 7.1 defines the public
  surface). Red test = the #131 source-alias guard.
- Task 1.2: `joinKind: "left"` as an additive union variant
  (`joinKinds` as-const set), `leftJoin()` stage (shared `appendJoin`
  helper), kind-aware join rendering, codec acceptance — the codec's
  fail-open guard test, which had used `"left"` as its unknown-value
  example, now uses `"right"`.
- Task 1.3: `returning({ alias: expr })` object projections on
  insert/update/delete (shared `resolveReturning`; aliases
  snake_cased like the select projection; `empty-returning` fail-fast),
  no-arg behavior unchanged. `ReturningProjection`/`JoinKind` exported
  per the index convention.
- tasks.md group 1 reworked under the amended D94 (35 → 32 tasks; the
  original 1.2/1.4/1.5 [design] items are settled: call shapes = core's
  existing surface, join variant and returning selection by symmetry);
  group durations appended to `openspec/task-times.csv`; one `minor`
  changeset (fixed group — naming core moves all three).

### Internal processing

Strict TDD per task: scaffold red = vitest unrunnable without the
package; left-join red = `leftJoin is not a function` + codec
`unrecognized "left"`; returning red = three failures including the
runtime silently ignoring the extra argument. Gates after each green:
Biome 323 files clean, check-types 12/12 turbo tasks, full test suite
green (core 807 + query 1), CRAP 0/976. retarget/walk needed no changes
(kind-agnostic spreads, verified by grep before deciding). Estimates
vs actuals recorded per task; the IR-strategy owner wait (~1 min) is in
`waited_user_min`, not `actual_min`.

Migrated from the single-file entry `.blackbox/2026-08-26-query-layer-group1.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-26-query-layer-group1.md`.

<a id="w3"></a>
## W3 — 2026-08-26 — add-query-layer group 2: the compiler (piece team g2)

_2026-08-26T00:00Z_

Session: Claude Code (Fable 5) as lead; piece team g2 (planner: Opus,
implementer: Sonnet, reviewer: Opus) under team-up v2 (D5/D88) — the
first piece-team run. Owner inputs are English rewrites of Korean
originals; team decisions reached the owner only through the lead.

---

### What the piece built

Tasks 2.1–2.6, 17 commits, strict TDD (red watched per task; the two
tasks subsumed by shared implementation — 2.3, 2.4 — are recorded as
such in tasks.md rather than given fake reds). The compiler renders by
lifting literals to `$n` `RawSqlNode`s in render order and delegating
to core `renderQuery`; `sql` is a thin wrapper over core's tag. Also:
the CRAP gate now measures `packages/query` (lead-approved scope
extension: `TARGET_PACKAGES` entry + README block derived from it
instead of a hardcoded string that would have silently stayed wrong).

### Internal processing (what review actually caught)

The reviewer worked artifact-only in `/tmp` detached worktrees. Caught
before merge: a runtime crash in code not yet written (adding the
`{statementExpr}` union branch would pass tsc but crash at dispatch —
restructured so a missing branch is a `TS2345`, proven by deleting the
check in a scratch tree); a `pnpm check` failure from package-scoped
linting missing `scripts/` (rule changed: verify from the repo root);
three tests that passed without verifying their contract (culminating
in the team rule "the numbering contract is only verifiable in SQL
text"); and the README hardcoding. `waited_user_min` stays 0 in the
ledger: owner-decision waits overlapped parallel work and were not
wall-clock measured — the team chose unmeasured-over-estimated, and the
lead agrees. Handoff note for group 4: `const f = (): never => …` does
not narrow control flow after the call (use a `function` declaration or
`return throwX(...)`), measured in scratch by the reviewer.

Migrated from the single-file entry `.blackbox/2026-08-26-query-layer-group2.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-26-query-layer-group2.md`.

<a id="w4"></a>
## W4 — 2026-08-26 — add-query-layer group 3: type inference (piece team g3)

_2026-08-26T00:00Z_

Session: Claude Code (Fable 5) as lead; piece team g3 (planner: Opus,
implementer: Sonnet, reviewer: Opus). Owner inputs are English rewrites
of Korean originals; team decisions reached the owner only through the
lead.

---

### What the piece built

Tasks 3.1–3.16 plus a design pivot and three reworks; four review
batches, all PASS; goldens and `examples/**` byte-identical throughout
(the type-level extension provably never leaked into runtime output).
User-visible: types flow from declarations —
`uuid().primaryKey().defaultRandom()` infers `string` (it would have
been `string | null` without the F7 fix mirroring
`materializeNotNull`), `serial().primaryKey()` is optional on insert,
`bigint({mode})` chooses precision, `$type` narrows only, interval is
a canonical structural value, unbranded json/jsonb are `unknown`, no
codegen. Parked with reasons pinned in code and spec: #307 (left-join
nullability), #308 (generated columns), #310 (mode-default constant
derivation — with an explicit "do not weaken the exhaustiveness
assertion" trap note), #311 (`ColumnRef` carrying meta/source — same
root as #307).

### Internal processing (what the verification machinery caught)

The piece's stance: "a test exists" is not evidence. The catches:
**phantom TMeta** (a type parameter that never bottoms out in a
property is structurally unobservable — deliberately-wrong assertions
passed `check-types`; fixed with a unique-symbol anchor, after which
every task carried a break-it-on-purpose probe run against the gate
that actually judges it); **`.array()` meta loss** and **implicit
PK/serial notNull** (found before they could silently mistype every
example primary key); **silent `'bigint'` truncation and
empty-string→0** (caught by requirements back-derivation — a class
mutation checks cannot catch, since an unimplemented requirement has
nothing to break); **name-matching inference rejected** with the
`select({ id: posts.title })` counterexample (the no-lying rule applied
to inference itself; object-form narrowed honestly to family-based
`T | null`). The final CRAP failure appeared only after the lead's
rebase — the gate's own definition had widened between bases (group 2
added `packages/query` to the scan), caught because the reviewer runs
all gates every batch regardless of the agreed tripwire scope; the
split was verified as purely structural by differential execution (75
input×mode combinations against the pre-split implementation, zero
mismatches). Lessons kept: a rebase changes the judging environment
even when it changes no code; a gate report must list what was not run;
the lead owes in-flight pieces notice when a merged piece widens a
gate.

Migrated from the single-file entry `.blackbox/2026-08-26-query-layer-group3.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-26-query-layer-group3.md`.

<a id="w5"></a>
## W5 — 2026-08-26 — add-query-layer group 4: execution + driver contract (piece team g4)

_2026-08-26T00:00Z_

Session: Claude Code (Fable 5) as lead; piece team g4 (planner: Opus,
implementer: Sonnet, reviewer: Opus). Owner inputs are English rewrites
of Korean originals; team decisions reached the owner only through the
lead. Final SHA `f4d57a8`, verdict PASS, zero open defects, zero open
decisions.

---

### What the piece built

Driver contract with an **exhaustive capability `Record`** (an
undeclared capability is a type error, not a falsy read; mandatory
prerequisites are not capabilities; `false` is fail-closed) and the
error contracts settled by the owner earlier: `query-execution-failed`
carries SQL text in the message but **params never appear anywhere**;
`result-conversion-failed` names the column; `undeclared-role` lists
the declared set; nested transactions fail with
`nested-transaction-unsupported` (savepoints parked as #313).
`db.as(context)` validates roles against the union
grant∪policy∪exported-roleName∪driver-contributed, quotes via
`quoteIdentifier` only, and applies settings through parameterized
`select set_config($1,$2,true)`. `db.fn.*` resolves scalar functions
to a value, not rows, and a silent scalar fallback was replaced by
fail-fast — which made the untyped-scalar path unreachable and
*tightened two types for free* (the piece's fourth and last
"type-was-lying" case closed by fixing behavior, not annotating it).

Review inversion of the spec surfaced **two requirements no task
owned** (typed rows for `execute`, `db.fn` static typing). Without
that back-derivation the group would have closed "complete" with four
spec SHALLs unimplemented.

### The seven "green but unverified" patterns (reviewer's wording, attributed)

All seven occurred while five to seven gates were green; none was
catchable by any gate. Kept verbatim as the piece's core yield:

1. **Vacuous assertion** — comparing a field, but only in cases where
   it is always empty (`params: []` in all three statements). (batch A
   FAIL; the piece's only pure-discipline rework, 1.3m)
2. **Loose type match** — `Record<string, unknown>` matches nearly any
   shape; without exact-match plus no-excess-keys the assertion is
   meaningless. (implementer, self-corrected: the strict-subset fixture
   leaked one direction via width subtyping → replaced with disjoint)
3. **CRAP drop ≠ verification gain** — splitting a branch clears the
   threshold without adding a single assertion; the number is a pass
   condition, not evidence of quality.
4. **Implementation without a requirement** — code exists, no
   production caller (`convert.ts` was unit-only until `4.4-wiring`);
   coverage and CRAP both green, so gates are *in principle* blind to
   it. (implementer, self-found)
5. **Post-hoc justification in contract documents** — when a spec or
   tasks.md sentence is widened to cover an implementation's drift,
   spec and code agree and no later review can catch it. It actually
   happened: 4.10 was once closed by redefining its scope in tasks.md;
   reopened, and 4.8 (spec deltas) was deliberately sequenced last with
   two-way drift checks against the owner's original wording.
6. **Name-based proof of absence (the verifier's own version)** — the
   reviewer concluded "no function cases in goldens" from a directory-
   name grep, then self-refuted; it would have excluded the *only* byte
   evidence for 4.11-mutation's harmlessness. Included at the
   reviewer's own request: without it the list reads as "implementer
   traps", when the real subject is misalignment between the observing
   instrument and the observed.
7. **Accidental equivalence (implementer, self-found)** — a mutation
   probe stayed green and the first instinct was "weak test", but a
   *different path was independently producing the same observable*.
   The first six are "the assertion doesn't catch it"; this one is
   "the assertion catches something, but not what it aims at" — it
   defeats mutation probing itself. The fix is fixture isolation, not
   stronger assertions.

> Green does not mean "passed"; it means "nothing was looking."

Two operational lessons, separate from the patterns (reviewer, at
dissolution): **baseline pre-capture is a precondition of judging** —
capturing base-green during idle time deleted the entire
"pre-existing vs new failure" reconciliation from every batch; and
**pattern 7 applies to citation too** — the evidence a verifier picks
can itself be "same observable, different cause" (the reviewer once
credited the wrong test for an observation; the planner caught it), so
even cited evidence needs a mutation check.

### Precedent ruling (§5): the core "type-surface only" rule binds by intent, not letter

`mutate.ts`/`define-function.ts` contain runtime-text changes (a
`unique symbol` anchor declaration, a `const stage` + cast). The
reviewer flagged them, declined to FAIL, and asked for a ruling; the
lead and planner upheld it. Decisive argument: a `unique symbol` type
cannot exist without a value declaration, so a literal reading makes
the owner-directed work (B)/(a) impossible. The rule's target is
"changing behavior under cover of type work", not declarations
intrinsic to making a type hold. Grounds recorded: no new statements,
branches, or value changes; identical in form to g3's
`columnMetaBrand`; behavior invariance proven by three green
harmlessness branches (core suite incl. goldens, examples chain SQL,
unchanged compilation of non-generic consumers). Kept as precedent —
the same question will recur, and it was answerable only because the
reviewer escalated with grounds instead of ruling silently.

### Incidents

**Raw NUL byte** (`f4d57a8`, 10m same-direction rework): an
adversarial test marker containing a literal `\0` turned
`context.test.ts` — the piece's most security-sensitive test file —
binary. Measured damage, not hypothetical: `git diff` showed
`Bin 0 -> 12340 bytes` (invisible in PR review) and plain `grep`
found 4 of 19 real matches. Functionally green throughout; replaced
with the `\u0000` escape, byte-identical semantics, file back to text.

**Backup loss, self-reported and independently closed**: the
implementer lost a `convert.ts` state mid-wiring, restored it, and
self-reported. The reviewer verified the restoration three ways —
diff shape (one test file +10/-0, no `src/` change), content
(`convert.ts` diff zero lines), and behavioral cross-check (all gates
green without mutation ⇒ a loss would have been red). Policy held:
self-reporting is never penalized, and the reported outcome is still
verified mechanically.

### Measurement notes (ledger)

Implementation 177.9m (core tasks 95.3m vs 142m estimated = **67%**;
five NEW rows 30.8m for review-inversion/self-found incompletions —
explicitly `not rework`; process costs 37m in eight named rows; rework
2 rows, both same-direction repairs, **zero re-analysis reworks**),
review 24.9m, prep 29m kept as an undistributed `4.prep` row. Three
derivation methods coexist and are tagged per row — `measured`
(batches A/B, live timestamps), `commit-interval approx` (batch C,
after a compaction lost live notes; approximations that inflated up to
9× against known measurements were corrected back), `step-based
estimate` (one row, where the commit interval contained judging waits
— the implementer refused to let wait time masquerade as rework time).
The tags must survive: a future estimator has to distinguish method
variance from difficulty variance. Tokens: 2,667 requests, 2,206,258
output tokens across the three role sessions, 99.5% cache hit.

### Handover kept

Uncovered branches → #315; `ExecuteResult`'s documented imprecision
(un-`returning()`'d mutation) stays tsdoc'd; group 7 must not re-export
the test-only symbols (`resolveColumnState`, `columnPlanForResult`,
`convertRow`, `ColumnPlanEntry`); parked: #307, #308, #313.

Migrated from the single-file entry `.blackbox/2026-08-26-query-layer-group4.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-26-query-layer-group4.md`.

<a id="w6"></a>
## W6 — Groups 5/6 re-plan and [design] pre-settlement round (add-query-layer, #293)

_2026-08-27T00:00Z_

### What was built

- `tasks.md` groups 5 and 6 rewritten from 3 tasks each to 7 + 6,
  every former [design] item resolved in the group headers, red tests
  and file lists per task (D88).
- `packages/query` gained a provisional entry surface: `src/index.ts`
  barrel + source-pointing `exports` in `package.json` — discovered as
  a hard prerequisite (the package had no entry point at all, so
  neither driver package could resolve `@hejbro/query`). Task 7.1
  replaces this surface; the barrel deliberately excludes the four
  test-only conversion exports and `sql`.
- Parking issues #317 (transaction-mode pooler capability story) and
  #318 (claims-provider callback automation) filed under #282.

### Decision rationale

- **D1 nominal typing**: owner preference for the Drizzle-parallel
  surface and familiar DX; costs accepted knowingly (peer `pg`,
  `@types/pg` in the public surface, heavier unit-test fakes).
- **D2 per-query override**: verified against Drizzle's actual source
  as the production-proven mechanism; global parser mutation rejected
  as silently rewriting the user's own queries; driver-side conversion
  rejected for splitting the conversion path and truncating
  microseconds (postgres-interval carries milliseconds).
- **D3 decorator**: zero duplication, no wrapper-drift class, keeps
  g5/g6 truly parallel (group 6 depends only on the contract type),
  and the same shape reuses for Nile (also wire-standard Postgres).
  The Drizzle comparison showed the same division of labor —
  transport generic, preset contribution as data — with hejbro
  productizing the RLS wrapper Drizzle leaves as a user exercise.
- **D4 overload**: closes the visible verbosity gap with
  `drizzle(url)`; lifecycle follows Drizzle (expose, never
  auto-close).
- **D5 claims object**: the decisive chain was factual. The owner's
  "the service verifies it" intuition is true only on the PostgREST
  path; the TCP driver sits in PostgREST's seat and Postgres itself
  never verifies claims. The owner then falsified the assistant's
  HS256-secret proposal (signing-keys docs: legacy, "no longer
  recommended"), and the Clerk/Auth0 scenario showed a token-accepting
  surface either breaks on non-Supabase issuers or forces hejbro to
  re-own per-issuer JWKS policy. The owner's final formulation —
  verification belongs to the auth layer that already does it; the ORM
  receives its verified output — is exactly the claims-object surface,
  so the settlement records the owner's own reasoning, not a
  concession to the assistant's.
- **D6**: operational batching allowed by the brainstorming skill's
  exception for decisions that cannot constrain other open questions.

### Internal processing

- Evidence fetches: Drizzle node-postgres `session.ts` (per-query type
  parser overrides), Drizzle RLS docs twice (no Supabase driver; user
  hand-rolls the context wrapper with `sql.raw`; `createDrizzle`
  receives a decoded claims object obtained via `getSession` +
  `decode`, unverified), Supabase signing-keys doc (HS256 legacy
  status, JWKS endpoint), third-party-auth overview and Clerk pages
  (`accessToken` callback attaches, platform verifies, Data-API-only
  scope, `role: authenticated` claim requirement).
- One recommendation reversal, recorded as such: the assistant
  recommended claims-only, then (on the owner's "both" push) a
  verified-token path with an HS256 secret, then returned to
  claims-only after the owner falsified the HS256 premise and the
  third-party scenario landed. Each swing followed new evidence the
  owner's questions forced; the final state matches the first
  recommendation but for corrected reasons.
- Process fault, owner-caught (input 10): the M2 ledger line
  ("확정 n/N · 지금 · 남은 큐") was dropped mid-round while handling the
  interleaved model-naming instruction; restored on the spot. The
  earlier interval-parser claim about `String(PostgresInterval)`
  breaking `parseInterval` was asserted from API knowledge, not
  executed code — group 5's scout task 5.0 pins it against the
  installed `pg` before any implementation trusts it.
- Prerequisite discovery: `packages/query` had no `exports`, no build,
  no `src/index.ts` — found by reading the package manifest before
  planning, not by a failed resolution at implementation time.

Migrated from the single-file entry `.blackbox/2026-08-27-query-layer-g5g6-replan.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-27-query-layer-g5g6-replan.md`.

<a id="w7"></a>
## W7 — add-query-layer group 5 — `@hejbro/pg` vanilla driver

_2026-08-27T00:00Z_

Piece team g5 (planner opus, implementer sonnet, reviewer opus; team-up
v2), worktree `query-g5-pg` off dev `1caad14`, rebased onto `d15fee1`
(post-g6) at close with zero conflicts; 20 team commits plus this
close-out. All [design] decisions were owner-settled before summoning
(see `2026-08-27-query-layer-g5g6-replan.md`). This entry is the
execution record; every claim below traces to planner reports or
reviewer measurements relayed to the lead during the piece.

### The handover principle (reviewer's closing synthesis, placed first

on the planner's request)

> **A green whose cause is unverified is not evidence.**

Every failure this piece caught was a variant of that sentence:

| Case | Why it was green |
|---|---|
| CRAP 1104 → 1104 | the gate never looked at the new package |
| GAP-2 attempts 1–2 | the mutation was never applied |
| turbo cache replay | the result belonged to another worktree |
| D4 (owner ruling ①, second clause) | the assertion only read a reference |
| `setupSession` sentence unmapped | nobody exercised the path the sentence claimed |
| C1 `(oid, format)` | the test pinned only one axis |

The three named techniques — decompose an owner ruling clause by
clause and bind each; the 3-step mutation-validity protocol (assert
anchor → verify the file changed → run); apply exemption rules by
their grounds, not their shape — are instances of the sentence, kept
below it so a new face of the same failure is still caught. Symmetric
pair: g6's "an unverified red lies as much as an unverified green".

### What landed

`pgDriver(pool | connectionString)` (owner D1/D4: instance-based with
nominal `pg` typing, `pg` as peerDependency `^8.23.0` narrow-by-
evidence; the connection-string form constructs and owns a `Pool`
exposed as `driver.client`, never auto-closed). Per-query `types`
override (owner D2): oid 1186 raw text, every other oid delegated with
**both** `(oid, format)` arguments — the scout proved pg replaces (not
merges) the client's TypeOverrides, so self-delegation is load-bearing,
and the format axis is mutation-bound after C1 showed a one-argument
delegation passed every test. WeakSet-guarded checkout pin
(`set intervalstyle to 'postgres'` once per physical connection,
ordered before the first caller statement; pin recorded only after
`setupSession` succeeds — the pin-failure defect the planner found by
source read, where a failed pin left the client marked pinned and
silently unpinned forever). Transaction: BEGIN/COMMIT, rollback +
rethrow with the owner-ruled double-failure semantics — the original
callback error rethrown **unmodified** (no attached fields: an error
field is observable surface), the connection discarded via
`release(err)` (verified against installed pg-pool source to the line:
`index.js:392` `_remove`; double-release throw at `_releaseOnce`), a
single release path. Docker integration harness (`test:integration`
outside default `pnpm test`, loud failure with guidance when Docker is
absent): a real postgres:17 round-trip proved bigint precision past
MAX_SAFE_INTEGER, numeric string mode, `IntervalValue` (override + pin
jointly), and Date columns — and caught a real bug type-checking never
would (`docker port` returns IPv4+IPv6 lines; the parse produced a NaN
port → ECONNREFUSED). Spec delta: arrival-shape table scoped to what
5.6 proved, interval sentences scoped to single (non-array) columns
(#320 cross-referenced), and the session-setup sentence split into the
two claims actually proven — the hook sends the pin (direct-call
test), the driver pins at checkout (ordering test) — with the
"checkout goes through the hook property" claim deliberately left out
of the spec until #323 is fixed.

### Reviewer findings (all by independent measurement or mutation)

1. Cross-worktree turbo cache sharing, root-caused to the main
   checkout's `.turbo/cache` by artifact hash — promoted to the
   session-wide `TURBO_CACHE_DIR` isolation rule (recorded fully in
   the g6 entry; #102's second face).
2. int8-identity: the planner's delegation witness was invalid (no
   registered parser → identity either way); valid witnesses fixed
   before any code existed.
3. The vitest exclusion pattern missed directory-form integration
   tests, and the real silent-collection risk is `passWithNoTests`
   (one line flips exit 1 to 0, measured), not vitest defaults.
4. **GAP-2**, the severity peak: removing `execute()`'s release left
   all tests green — a driver leaking a connection per query passed
   the suite. Root cause: 5.5's refactor (pool.query → pool.connect)
   created a new contract axis that 5.4's release criteria predated.
   Lesson carried forward: a refactor commit owes an inventory of the
   contract axes it creates.
5. GAP-1 was unobserved in both directions (the fix also left all
   tests green) — fixing a defect and making it observable are
   separate obligations; GAP-3: a tsdoc-promised scope with no test.
6. D4: the second clause of the owner's rollback ruling (no attached
   fields) was unguarded — found by decomposing the ruling clause by
   clause. The planner's later note: the one instruction of its own
   that the reviewer could overturn was phrased conditionally
   ("narrow if unstable") — a falsifiably-phrased directive is itself
   a safety device; an unconditional one would have silently weakened
   the binding.
7. The spec sentence "inside its session-setup hook … SHALL send" was
   unmapped (a no-op `setupSession` left everything green) — caught by
   applying the exemption rule by grounds (group 4 made `setupSession`
   contract surface, so this is an externally observable positive
   claim), which surfaced #323.
8. An unapplied mutation is output-identical to a test that cannot
   catch — the instrument's own false negative; the 3-step protocol
   earned its keep the same day (GAP-2's verdict was nearly issued on
   invalid grounds twice before the valid run).
9. Two self-corrections, both against its own prior claims via
   measurement (withdrew the "macrotask close is unfalsifiable"
   framing where a nearer variant became bindable; discarded
   `import.meta.resolve` as a probe because the Node resolver bypasses
   vite aliases — replaced with "dist absent + import succeeds").

Four planner instruction errors (int8 witness, "0 passed looks
green", overstated configDefaults risk, the ownKeys narrowing) were
all corrected by reviewer measurement; the planner self-reported each,
plus two stale-SHA verdict crossings resolved by reflog with the
"one SHA, sole judgment target" protocol adopted after.

### Ledger honesty

The implementer reclassified its entire time table from "measured" to
"approx" on its own initiative — no timer ran, and self-reported
values presented as measurements would be precision theater. The
3.8× overrun (est 68 → ~256 pure minutes) is attributed by the
planner to its own planning: [design] decisions were pre-settled but
quality-gate wiring (integration exclusion, CRAP registration, alias
sharing) and test-binding standards were not, so they arrived as
rework rounds. Adopted as the g7 re-plan prescription: pre-settle
gate wiring and binding standards in the task header, not just design
decisions. Legitimate costs kept apart: the mutation protocol (without
which GAP-2 ships — one production outage exceeds the whole piece) and
real-source verification (pg 8.23.0, pg-pool release semantics),
which was reused across later tasks.

### Issues this piece filed (lead-authored)

#320 expanded (interval[] bypasses the 1186 override — array columns
have no conversion path), #322 (insert() value types reject the very
types the column DSL declares — found seeding the harness, worked
around with raw execute without weakening the read-side proof), #323
(decorator-wrapped setupSession bypassed by the checkout closure —
today harmless, a composition landmine; the spec deliberately does not
claim the property path until fixed).

### Close mechanics

Rebased onto post-g6 dev with zero conflicts; close gates re-run with
`TURBO_CACHE_DIR` isolation and `--force` (check-types+test 22/22,
`Cached: 0`; check 384 files; `check:crap` 0/1118 across four
packages; `changeset status` exit 0; `openspec validate --strict`
valid). README CRAP block recomputed post-rebase per the N1 per-PR
sequencing (1108 → 1118 @ the rebased tip). H5 (a test title quoting
the pre-split spec sentence) fixed in this close commit. No changeset:
the piece touches only a private package, docs, and shared scripts.

Migrated from the single-file entry `.blackbox/2026-08-27-query-layer-group5.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-27-query-layer-group5.md`.

<a id="w8"></a>
## W8 — add-query-layer group 6 — Supabase driver decorator + RLS context surface

_2026-08-27T00:00Z_

Piece team g6 (planner opus, implementer sonnet, reviewer opus; team-up
v2), worktree `query-g6-supabase` off dev `1caad14`, 9 team commits plus
this close-out. All [design] decisions were owner-settled before
summoning (see `2026-08-27-query-layer-g5g6-replan.md`); zero decision
waits occurred during implementation. The lead relayed rulings between
the two parallel pieces throughout; every substantive item below is
sourced from planner reports and reviewer measurements.

### What landed

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

### Incidents and their mechanics (all empirically pinned)

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

### False-green taxonomy (five faces — symmetric for red, all observed live this piece)

1. green that never ran (turbo cache replay), 2. green that collected
nothing (`passWithNoTests` — one line flips exit 1 to 0, measured), 3.
green that verified nothing (a dead `@ts-expect-error` — liveness
proven via TS2578 when the error was satisfied), 4. green that
collected the wrong thing (mergeConfig concat), 5. green from a
mutation that was never applied (the instrument lying — g5's find,
adopted here as the 3-step validity protocol before any "survived"
verdict). Common pathology: a declaration diverging from the effective
value. The planner's post-close reframe, adopted on request: the list
is not green-specific — an unverified red lies exactly as much as an
unverified green (the reviewer's own `pg` probe went red for
`Cannot find package 'pg'`, not the intended reason; 6.4's real-stack
M9 existed because a live database can satisfy an assertion by
accident, so a positive result alone proves nothing). Three reviewer
instruments carry to 7.x, each with its usage caveat recorded by the
handover: `vitest list --filesOnly` disjointness checks (capture the
baseline list from the pre-change tip; judge as sets — disjoint AND
union-complete, since matching counts with swapped contents is exactly
face four; sensitive to install state), effective-config dumps (must
call function-form configs; always cross-check against `list` — each
answers only half), and the alias-sentinel probe (plant a value only
the source file has; categorically stronger than reading the config,
revert-verified via clean `git status`).

### Verification highlights

Nine mutations across both batches, all killed by exactly the intended
tests; `contributedRoles: []` killing 6.3 proved a first-run-green test
was not vacuous, and after strengthening, M1/M2/M5 reach 6.3 because it
asserts the actual SQL and params that hit the driver (`set local role
"anon"`, serialized claims JSON in `set_config` params) — spread order
is pinned at the wire level. CRAP non-regression was judged against a
frozen baseline snapshot (new functions only, 1.00–2.00, nothing
existing moved, no functions vanished). The final gates all ran with
the isolated cache and `--force`, `Cached: 0` cited.

### Process notes

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

Migrated from the single-file entry `.blackbox/2026-08-27-query-layer-group6.md`, kept verbatim at `.blackbox/293/artifacts/2026-08-27-query-layer-group6.md`.

