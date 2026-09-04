# Work — quickstart-now/hejbro#378

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-defect-metric — the number that grades the process (#378)

_2026-08-28T00:00Z_

Lead-direct plain cycle off dev `c5d693b`, parallel with the gc2 and
sk piece teams (README's ai-metrics block is a lead-owned artifact, so
no conflict — sequencing handled by the single writer).

### What lands

The `escaped-defect` label (defect found after its introducing change
merged; deliberate in-flight deferrals excluded — #341/#342 were
sequenced follow-ups filed during harden, so they are NOT escapes),
backfilled onto eleven issues, and a rollup table in README's
ai-metrics block keyed by INTRODUCING change with a found-by column —
the per-layer catch attribution is what tells whether each
verification layer earns its cost. Notable readings already visible:
add-query-layer leaked 8 (5 caught only when harden's reconnaissance
went looking), the two tooling escapes were both
never-fires-class gate blindness, and add-array-ergonomics leaked 0 —
the first change run fully under the accumulated verification
standards. The table refreshes at each change close-out by the lead
(single-writer rule).

Migrated from the single-file entry `.blackbox/2026-08-28-fix-defect-metric.md`, kept verbatim at `.blackbox/378/artifacts/2026-08-28-fix-defect-metric.md`.

