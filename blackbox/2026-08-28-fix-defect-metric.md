Refs:
- README.md @ blob 2e876c1bcb17a144e7b927bc570b2e879cb1860b

# fix-defect-metric — the number that grades the process (#378)

Lead-direct plain cycle off dev `c5d693b`, parallel with the gc2 and
sk piece teams (README's ai-metrics block is a lead-owned artifact, so
no conflict — sequencing handled by the single writer).

## Owner inputs (English rewrites)

From the external AI review (finding 11: time is measured, but
post-merge bugs are not counted — the only number that shows whether
the process produces quality). Lead verification refined it: the raw
data already exists (every escaped defect is individually filed —
the harden family, #349, #361); what was missing is the labeling
convention and the rollup. Adopted into the #282 gate by the owner.

## What lands

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
