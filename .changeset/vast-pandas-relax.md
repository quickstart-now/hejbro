---
"hejbro": minor
---

Add `hejbro upgrade`, moving a project whose committed snapshot is in an
older released format (floor: format 5, 0.1.1's own shipped format)
forward without a reset: it rewrites the snapshot file at the current
format and re-chains the tip migration's own banner by rewriting its
`-- snapshot:` line and inserting a new `-- upgraded-from:` line under
it naming the pre-upgrade hash — no other migration file changes. It
refuses with `chain-tip-mismatch` if the tip's recorded hash doesn't
match the snapshot as stored, before writing anything; a snapshot
already at the current format is a no-op. `hejbro history` and `hejbro
restore` resolve an upgraded tip transparently, and every other command
meeting an older released format now names `hejbro upgrade` as the next
step.
