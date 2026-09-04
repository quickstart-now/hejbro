# Work — quickstart-now/hejbro#374

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — adversarial-review-stage — the layer that reads the spec alone (#374)

_2026-08-31T00:00Z_

Lead-direct plain cycle off dev `dd1fae8`, parallel with the cp piece
team (add-context-provider) — no file overlap: this change owns
`openspec/config.yaml`, the design spec's decision log, and AGENTS.md's
cycle line; the piece owns `packages/query`.

### What lands

D106 in the decision log, its guidance injection in
`openspec/config.yaml`'s archive operation, and the cycle line in
AGENTS.md. The four open questions were settled 2026-08-31 under the
owner's standing delegation, by the lead session (to be surfaced on
return):

- **Position: pre-archive, post-merge.** The deltas are final and the
  surface is real (published on dev); blocking the archive costs
  nothing — it is a docs move — where blocking a piece merge would
  serialize implementation on an external read. The precedent is
  align-spec-corpus, which ran against the merged corpus.
- **Runner: a context-free session,** spawned fresh — zero piece
  context, never a piece-team member, a different model family from
  the piece's planner when practical. The stage's entire value is the
  absence of inherited framing; a standing red-team member inside the
  team would re-acquire the framing within one piece.
- **Inputs: delta specs + public surface only** (`openspec show <id>
  --diff`, skills/hejbro, the exported API, generated artifacts) —
  never proposal rationale, design notes, transcripts, or
  implementation reasoning. Reading the reasoning is how every other
  layer already reads; this one must not.
- **Routing: severity-split.** A delta-scenario-contradicts-shipped-
  behavior finding blocks the archive until repaired or owner-ruled —
  it is tripwire-class by definition. Everything else files as a
  tracked issue, sub-issue of the phase that will handle it: the
  no-orphan rule exists because bare "Related:" references were
  measured to get dropped. The report persists as `evaluation.md` in
  the change directory, so the archive carries the review alongside
  what it reviewed.

### Why the alternatives died

Pre-piece-merge review reviews a moving surface and puts an external
read on the critical path of every group. An embedded red-team role
inherits the framing within a piece — the align-spec-corpus evaluator
produced F32+P18 from the specs alone precisely because it had nothing
else to read. Ad-hoc routing was not considered seriously: the
repository has already paid for that lesson.

### First application

The stage applies from the next archive onward — the in-flight
add-context-provider change (#318) will be its first subject: the
lead spawns the isolated evaluator after that change's PRs merge and
before its archive PR.

Migrated from the single-file entry `.blackbox/2026-08-31-adversarial-review-stage.md`, kept verbatim at `.blackbox/374/artifacts/2026-08-31-adversarial-review-stage.md`.

