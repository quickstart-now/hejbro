Refs:
- packages/pg/src/driver.ts @ blob 9c481e4a918b94ea06147d42538875adafffe2fa
- packages/pg/package.json @ blob baaa7c06c3bb9b9bb0ff8f3b9ae7c7692970a85b
- packages/pg/test/driver.test.ts @ blob 59cbd11f3eae56f413a2bdee4ae25d82c3b5294a
- openspec/changes/add-query-layer/specs/driver-contract/spec.md @ blob ddc33d72dc0144c8538506c90dea8e3c45b23943
- scripts/crap-report.mjs @ blob 9d48e3c47a38cdb50d1507d2ec2765d062de8470
- openspec/changes/add-query-layer/tasks.md @ blob f755f299944093e99724aa0f01920cd665360f68

# add-query-layer group 5 — `@hejbro/pg` vanilla driver

Piece team g5 (planner opus, implementer sonnet, reviewer opus; team-up
v2), worktree `query-g5-pg` off dev `1caad14`, rebased onto `d15fee1`
(post-g6) at close with zero conflicts; 20 team commits plus this
close-out. All [design] decisions were owner-settled before summoning
(see `2026-08-27-query-layer-g5g6-replan.md`). This entry is the
execution record; every claim below traces to planner reports or
reviewer measurements relayed to the lead during the piece.

## The handover principle (reviewer's closing synthesis, placed first
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

## What landed

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

## Reviewer findings (all by independent measurement or mutation)

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

## Ledger honesty

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

## Issues this piece filed (lead-authored)

#320 expanded (interval[] bypasses the 1186 override — array columns
have no conversion path), #322 (insert() value types reject the very
types the column DSL declares — found seeding the harness, worked
around with raw execute without weakening the read-side proof), #323
(decorator-wrapped setupSession bypassed by the checkout closure —
today harmless, a composition landmine; the spec deliberately does not
claim the property path until fixed).

## Close mechanics

Rebased onto post-g6 dev with zero conflicts; close gates re-run with
`TURBO_CACHE_DIR` isolation and `--force` (check-types+test 22/22,
`Cached: 0`; check 384 files; `check:crap` 0/1118 across four
packages; `changeset status` exit 0; `openspec validate --strict`
valid). README CRAP block recomputed post-rebase per the N1 per-PR
sequencing (1108 → 1118 @ the rebased tip). H5 (a test title quoting
the pre-split spec sentence) fixed in this close commit. No changeset:
the piece touches only a private package, docs, and shared scripts.
