# Decisions — quickstart-now/hejbro#375

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The round-trip witness runs in CI; D49 is amended by this PR, which the owner merges

_lead · extension · basis 412/D24, 412/D25 (oldest-first, no deferral); the owner's 2026-08-28 ruling on #375 (adopted, revision gated on the owner merging the PR carrying the amended row); D49's own rationale ("the same script can be called from a CI job later"); ci.yml carries no Docker leg today (read 2026-09-05) · 2026-09-05T04:33Z · ratified: pending_

The issue's problem is process-level: the D49 witness lives outside every enforced gate, so a skipped local run lets a generated-SQL regression merge (#869 is the same defect for the package integration suites). Terminal state chosen: add one CI job `roundtrip` (needs blackbox, ci-approval gating like verify, ubuntu's own Docker, Node 24, both examples) and amend the D49 row in the same PR. The decision-log edit is a hard gate; the 2026-08-28 ruling names the owner's merge of this PR as that approval, so the lead opens the PR and does not merge it. #869 stays separate: it needs a `test:integration` turbo task and the contention fix #870 first, and this leg is what it will run on. Not a required check yet -- rulesets are owner settings; noted in the PR body.

