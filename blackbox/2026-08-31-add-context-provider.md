Refs:
- .changeset/add-context-provider.md @ blob 863cd79a1096375e3d3fb62a69c4378599344bd8
- .changeset/harden-query-layer.md @ blob 3685b350ecc1cd2d25b69bf8655434d3d3df2fdd
- .changeset/harden-query-surface.md @ blob 94d6a67525724cc5ae2b4edac51b788e527b5160
- AGENTS.md @ blob 5d36d25881769919417728432634f080f9d56c4b
- README.md @ blob 9de4fc3c625840eaec1622614b81f4854b537ee5
- openspec/changes/add-context-provider/proposal.md @ blob 69eceb37d85834d7a472498182a4c3a8924f7231
- openspec/changes/add-context-provider/specs/rls-execution-context/spec.md @ blob d7ca1d7687d01160e75fa3f766b49b725aa8c88f
- openspec/changes/add-context-provider/tasks.md @ blob ed54b487ccd20cef187cc4b0831b657b50edbccc
- openspec/task-times.csv @ blob f0e5f4f5327d3d52159a1a4b7be777f505f93060
- packages/cli/test/exports.test.ts @ blob ea3cbff3cf1e1bc37dfd91dfddf310ab849c1925
- packages/query/src/db/context.ts @ blob b5e81d870771dca9aa81ec1b930023ea166109aa
- packages/query/src/db/db.ts @ blob f92cc04aa2d70ba2343c6ed6711ed505f45d65da
- packages/query/src/db/transaction.ts @ blob 066aba31d05353f52e17068ddff21d7687b39b14
- packages/query/src/index.ts @ blob da80cfc77a55a7c7e18555420b6f02cd486b7062
- packages/query/test/db/context-provider.test.ts @ blob 704f7514adb42d2146c11891a4f6d4b9a2594bba
- packages/query/test/exports.test.ts @ blob 0b7ddf95a9adc79fba8a6d0be97fd8226b78c46c
- packages/supabase/test/context-provider.test.ts @ blob fa3972a2c57d1a1b0520f9d24ef09655c71c4787
- skills/hejbro/SKILL.md @ blob df6fc914f00ebfe836406662ad992b16f83c3928
- skills/hejbro/references/query-layer.md @ blob a935ecacea4f6186965da479a5f3e4ea33ce7e89

(Taken from `git hash-object <path>` on the closing working tree, after
the review verdict and before the closing commit. The three
`openspec/changes/add-context-provider/` paths above will move when
this change archives; the pins are to be re-pathed in the archive PR,
blobs unchanged — the archive-vs-squash asymmetry recorded by the
extend-query-runtime entry.)

# add-context-provider — the generic context provider (#318)

cp piece team (planner opus, implementer sonnet, reviewer opus) off dev
`dd1fae8`, under the owner's standing delegation (2026-08-30: "handle
decisions that need me directly until I say I'm back") — every owner
gate below was exercised by the lead session as a delegated owner
decision, recorded here and queued for the owner's return review.

## Owner inputs (English rewrites)

The delegation itself is the owner input. The change executes the
re-scoping the 2026-08-30 layer finding recorded on #318: the
claims-provider callback the issue originally sketched on the Supabase
driver factory violates `rls-execution-context` (fail-closed,
path-independent validation whose whitelist unions four sources — three
of which do not exist on a driver value), so the feature moved to the
query layer with the preset reduced to an adapter. Four provisional
leanings from that ruling (explicit `as()` wins; no-claims applies the
anon context; once per execution, uncached; missing capability fails on
first execution) were left "to be settled in that change's own design
round".

## The [design] round: six reversals, then a seal

The one genuinely contested contract detail was what happens when the
resolver produces no context. The exchange flipped six times between
(B) "non-nullable resolver alone — the caller writes `?? asAnon()`" and
(A) "resolver plus fallback field — the layer applies it", not because
the arguments were bad but because lead rulings and planner reports
kept crossing in flight: each side repeatedly acted on the other's
stale message. Substantive facts surfaced along the way, each of which
genuinely moved the decision:

- (A)'s strongest fact: a fallback is a construction-time constant, so
  its role can be validated synchronously at `db()` — a typo'd
  anonymous role becomes a boot failure instead of surfacing at the
  first anonymous request. Verified in-repo before adoption, not
  assumed (the four-source whitelist completes before the options
  object is read, no cycle, an insertion point exists).
- (B)'s strongest facts: the preset's `asAnon()` role is
  driver-contributed and therefore always whitelisted — early
  validation has almost nothing to catch; the exposure narrows to
  callers hand-writing an anonymous role, and even they fail loudly at
  the first request (late but loud is not silent); and (B) keeps
  "empty resolution is unrepresentable" at the type level where (A)
  with an optional fallback demotes it to a runtime rule.

The crossings eventually duplicated the acknowledgment itself — two
acks sealing opposite variants — at which point the planner froze the
artifacts, isolated the contested surface (the dispute touched 2 of 6
tasks; the other four proceeded untouched), and asked the lead for a
single token. The lead answered `B`, and (B) it is: resolver alone,
non-nullable return, no fallback field, `context-provider-empty` when
the type system is bypassed, a throwing resolver propagating (failure
and absence are different claims). The alternative and its strongest
fact are recorded in the proposal for the D106 evaluator. Waste from
the reversals: zero minutes measured — the implementer had started
only after a sealed contract, and the planner's freeze kept it that
way.

Process lessons the crossings bought, adopted for later pieces:
[design] tasks go last in a group, not first, so contract wobble
cannot flow into implementation; a contract ruling stays un-acted-on
until the counterparty's acknowledgment lands; a report's file
citations carry the SHA they were observed at.

## Delegated rulings (beyond the A/B seal)

- Delta scope: `rls-execution-context` alone. A `query-execution`
  MODIFIED was drafted mid-round and withdrawn with the seal; the
  visibility it would have carried — registering a provider makes
  unscoped executions enter the transaction-wrapped path, an
  observable behavior change — lives instead in the ADDED scenario,
  which also states that the statement's own SQL and parameters are
  unchanged (that spec's "exactly the statement's pure compile()
  output" sentence is a faithfulness claim, not an exclusivity claim —
  the reading the scenario forecloses).
- Error code `context-provider-empty`, ruled on six measured
  precedents (subject-first naming: `undeclared-role`,
  `claims-subject-missing`, …), with a message that teaches the
  "no identity, no query" caller to throw from its own resolver.
- The stale "five published packages" count (the fixed group has six
  since `@hejbro/neon`): corrected in this PR in all three files on
  the propagation path — AGENTS.md (the normative source), tasks.md
  (where it had already spread via the planner's instruction), and the
  two pending changesets that would have published it in release
  notes. Ruled in-scope as error-propagation cutoff: a release note
  states facts as of publication, and a pending changeset is
  unpublished release bookkeeping, not a frozen record.
- One blocking rework, planner-caught before handoff: the provider
  path's transaction member initially assembled its own transaction
  and so bypassed `createTransactionApi`'s re-entry guard —
  "registering a provider silently removes the deadlock guard", a
  `query-execution` violation (the requirement is scoped to the db
  handle's own member, which a provider handle still is). Fixed by
  extracting `guardNestedTransaction` and sharing the one closure —
  duplicating the guard would have re-created, on the transaction
  axis, the very path-split this change polices on the validation
  axis.

## What the review measured

The reviewer's first-round mutation set confirmed the change's central
invariant — one validation path: a single `assertDeclaredRole` no-op
turned explicit-path and provider-path tests red at once. It also
caught a surviving mutant the suite missed: the `as()` precedence test
asserted only that the resolver was not called, never that the named
context was applied, so a fail-open mutant (explicit context dropped,
statement run unscoped) survived 706 green tests. The implementation
was correct; the test was absent. The fix was verified against the
*same preserved mutant* (the reviewer kept it as a runnable script
outside the repo, anchored to fail loudly on drift, precisely so that
"an assertion was added" and "that assertion holds load" would remain
separate claims): green on `97233f4`, red on `e2b4409`, same mutant,
same procedure. Eight-surface coverage is a ratchet — the
wire-provider-to-execute-only mutation turns 8 tests red, so a ninth
surface added without context dies in CI.

## The preset's share, measured

`packages/supabase/src/`: 0 lines changed, and the adapter test passed
on its first run — `asUser()`/`asAnon()` already produce the context
value. The layer finding's prediction ("with a generic provider the
preset's share collapses to ~zero") is now a measurement, and the G2
tripwire ("if any preset code becomes necessary, stop — the generic
design is wrong") never fired. The reviewer treated the empty diff and
the mechanism claim as separate assertions: the diff was accepted only
after a non-empty control (`packages/supabase/` as a whole), and the
mechanism was checked by emptying `contributedRoles` — the supabase
provider test goes red, so the preset path enters the four-source
whitelist through the driver-contribution arm and bypasses nothing.

## The estimation finding

G1's six tasks (est 47m) ran in 15 minutes — 0.32×; the
file-separable tasks ran 0.71× (G2 2.1), 0.75× (G2 2.2) and 1.11×
(G3). The diagnosis, confirmed across all three groups: the miss came
from mechanically applying D88's "over 10 minutes → split" to an edit
whose eight entry points assemble in one literal — splitting a
structurally single edit double-counts fixed costs and creates no
measurable boundary. Proposed refinement (queued for the owner): split
only where the split line coincides with a file boundary. The ledger
records the group as one measurement ("one row, not six") — the
implementer explicitly refused to back-fill per-task numbers by ratio,
which is the only reason the estimation error stayed visible.
