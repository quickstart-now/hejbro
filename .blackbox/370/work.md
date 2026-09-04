# Work — quickstart-now/hejbro#370

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — generated-columns group 2 — six contract gaps, all settled in the open

_2026-08-28T00:00Z_

Piece record for `add-generated-columns` tasks 2.1–2.4 (tracking
#370), built by the gc2 piece team (planner opus / implementer sonnet
/ reviewer opus) in worktree `gen-g2-kinds` off dev `9963d04`, verdict
PASS at `1259b43…` (reissued cleanly at that SHA after a post-freeze
amend; stale verdict discarded, not patched), rebased onto `ae3ba98`
with all 47 piece blobs identical — the verdict carries
constructively. Nine commits, +1581/−71, four review rounds, ZERO
rework verdicts, twenty mutations all gate-attributed with zero
survivors.

### What landed

Snapshot v6 (column `generated`/`identity` fields through the codec,
camelCase→kebab kind conversion at the snapshot boundary, fixture
sweep), the full create-emit grammar for all three variants (identity
NOT NULL materialized into the snapshot the way serial's is — E3),
identity diff alters (add/drop/re-kind/per-option `set` statements,
live-table golden), generated diff paths (expression change =
unconfirmed rebuild; generated→plain = `drop expression`;
plain→generated = a LOUD GUARD — E2), the six-option identity
renderer in one canonical order (E6), the column-order rebuild oracle
(E5), and the eight-file cross-package v6 sweep with tip-banner hash
recomputation and `hejbro verify` exit 0 on both examples (E1).

### The six gaps — each caught before it shipped

- **E2, the piece's defining find**: plain→generated emitted NOTHING —
  diff recognized the change, emit produced zero statements, verify
  then passed forever while the database silently lacked the
  expression. The reviewer found it by driving BUILT code through the
  three transitions, and all three members independently proved the
  approved "D32 confirmation" wording unimplementable: the
  confirmation keys on dropped NAMES (set difference), which a
  name-preserving transition can never reach. Ruled: the
  `unsupported-column-alter` guard with a two-step `Next:` remedy IS
  the design (an explicit user action beats a confirmable auto-drop);
  the spec delta, design decision 4, and the D100 row were amended at
  this closing, reported to the owner with veto standing.
- **E3**: the lead's briefing contradicted itself on identity NOT NULL
  materialization; the team measured the actual serial precedent
  (snapshot materialization) and the lead's (B) sentence was ruled
  void. Result: `"id" integer not null generated always as identity`
  renders straight through.
- **E5**: the expression-change rebuild puts the column LAST in real
  Postgres while the snapshot kept its old position — a divergence
  the rebuild path itself creates, so fixing it was ruled completion
  of 2.4, not scope growth. The oracle self-detects a rebuild from
  the two snapshots alone (both generated, texts differ) — no new
  channel; generated→plain correctly keeps its position (in-place).
- **E6**: the lead's "mirror sequence-kind's tokens" instruction had
  a false premise — the implementer greped before starting and found
  no such tokens exist anywhere. The renderer's tokens are PG's own
  identity_option keywords lowercased (zero-discretion derivation),
  canonical fixed order proven by a golden that declares options in
  exact reverse order and renders them canonical; `cycle: false`
  renders `no cycle`.
- **E1**: the sweep's grant was settled by precedent the reviewer
  found (D72 explicitly disclaims reproducibility across format
  bumps), flipping the planner's own initial recommendation; the
  final verification recomputed both tip hashes independently
  (`EQUAL: true`) and used tip-`parent` invariance as the marker that
  nobody regenerated the chains.
- The v6 "blast radius" claim in design.md was measured optimistic
  (a verify-pinned chain's tip banner moves) and corrected at this
  closing.

### Process record

One lead escalation was LOST because the planner emitted it as
session text instead of SendMessage (`to:"main"` rejected, wrong
fallback) — both sides waited on each other until the lead's direct
status query broke the deadlock; the rule (reports go through
SendMessage, session text is invisible) is now standing. One
post-freeze amend replaced the frozen SHA (the planner's own
instruction lacked the "follow-up commit only" clause); the reviewer
reissued the verdict cleanly at the new SHA and the rule is standing.
The witness list for group 4 gained two PG-semantics derivations the
team could not measure (identity requires prior NOT NULL; `drop not
null` rejected on identity) — written into tasks.md 4.1 at this
closing so the contract lives in the file. Ledger: 33m est → 215m
pure + 110m process (six contract-gap round trips; four PASS reviews);
tokens 1,442 requests / 1,101,074 output / 99.4% cache — the largest
piece of the change.

Migrated from the single-file entry `.blackbox/2026-08-28-generated-columns-group2.md`, kept verbatim at `.blackbox/370/artifacts/2026-08-28-generated-columns-group2.md`.

