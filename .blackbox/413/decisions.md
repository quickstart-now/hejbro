# Decisions — quickstart-now/hejbro#413

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The upgrade path ships as an explicit hejbro upgrade over the current decoder's lenient rules; the tip is re-chained with an upgraded-from banner line

_lead · extension · basis 412/D24, 412/D25 (oldest-first, full delegation); the owner's 2026-08-28 ruling on #413 (a real forward path from 0.2.0 on, downward stays a refusal); D101 (the #413 path supersedes the no-command sentence); measured: 0.1.1 shipped format 5 (git show hejbro@0.1.1:examples/postgres/hejbro.snapshot.json), 0.2.0-pre.1 ships format 8; verify's first check hashes the snapshot file bytes against the tip's banner line and re-hashes nothing else in the chain · 2026-09-05T04:43Z · ratified: pending_

Design forks settled (openspec/changes/add-snapshot-upgrade/design.md Q1-Q6): (1) reading an older released format = the current decoder's lenient rules + canonical form behind a floor of 5, measured against the 0.1.1 tag's twelve format-5 snapshots, never per-version decoders; a non-derivable required field is a tripwire, not a guess. (2) an explicit `hejbro upgrade`, never a silent step inside generate -- it rewrites a committed migration's banner and the user must see that in their diff; every other command keeps refusing and names the command. (3) the tip's `-- snapshot:` value is rewritten and the replaced hash goes on a new `-- upgraded-from:` line (public prefix parser; unknown to older readers, so ignored); precondition tip-hash == stored-file-hash, else chain-tip-mismatch and no write. (4) history matches the added commit's blob against either hash; restore rebuilds under the current format and compares with the current hash (measured in 1.5). (5) no flags; existing codes reused. (6) D101 row amended by the lead under delegation, surfaced on return. Ratification: owner on return.

