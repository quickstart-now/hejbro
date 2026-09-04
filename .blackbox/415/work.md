# Work — quickstart-now/hejbro#415

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-set-operations proposal — five settled, two parked, one recon audit

_2026-08-28T00:00Z_

Proposal record for the first of #299's three changes (D103), opened
the same day add-relational-reads archived. Lead-run brainstorm; the
recon was one Explore agent whose report the lead spot-verified
(three claims) before the first question — and then, mid-brainstorm,
the owner asked for MORE verification.

### What was parked, and where

D4 (window IR form: new `WindowNode` vs `FunctionCallNode.over?` —
the latter is a field-shape change to a snapshot-reachable node and
would force v8) lives in #416's body; D5 (the CTE from-source fork:
`FromNode` union vs a `with` side-channel — `TableRefNode` cannot
name a schema-less CTE) lives in #417's body. Both carry enough of
the recon to reopen cold. #299 became the umbrella with three
sub-issues (no-orphan rule); its own "IR in @hejbro/query" wording is
restated in D94 terms by the proposal.

### The physics that decided D103's node question

The g2/g3 landings measured the asymmetry this row leans on: a new
node VARIANT breaks compilation at every mapped-type site (eleven for
ExprNode, seven for QueryNode), while a new `SelectNode` FIELD is
silently dropped by the codec's fixed seven-key literal, the
renderer's clause list, retarget equality, walk child extraction, the
lifter, column-order, and view serialize. `(a union b) except c`
needing recursion closed the case.

Migrated from the single-file entry `.blackbox/2026-08-28-set-operations-proposal.md`, kept verbatim at `.blackbox/415/artifacts/2026-08-28-set-operations-proposal.md`.

