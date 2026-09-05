# Decisions — quickstart-now/hejbro#413

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The upgrade path ships as an explicit hejbro upgrade over the current decoder's lenient rules; the tip is re-chained with an upgraded-from banner line

_lead · extension · basis 412/D24, 412/D25 (oldest-first, full delegation); the owner's 2026-08-28 ruling on #413 (a real forward path from 0.2.0 on, downward stays a refusal); D101 (the #413 path supersedes the no-command sentence); measured: 0.1.1 shipped format 5 (git show hejbro@0.1.1:examples/postgres/hejbro.snapshot.json), 0.2.0-pre.1 ships format 8; verify's first check hashes the snapshot file bytes against the tip's banner line and re-hashes nothing else in the chain · 2026-09-05T04:43Z · ratified: pending_

Design forks settled (openspec/changes/add-snapshot-upgrade/design.md Q1-Q6): (1) reading an older released format = the current decoder's lenient rules + canonical form behind a floor of 5, measured against the 0.1.1 tag's twelve format-5 snapshots, never per-version decoders; a non-derivable required field is a tripwire, not a guess. (2) an explicit `hejbro upgrade`, never a silent step inside generate -- it rewrites a committed migration's banner and the user must see that in their diff; every other command keeps refusing and names the command. (3) the tip's `-- snapshot:` value is rewritten and the replaced hash goes on a new `-- upgraded-from:` line (public prefix parser; unknown to older readers, so ignored); precondition tip-hash == stored-file-hash, else chain-tip-mismatch and no write. (4) history matches the added commit's blob against either hash; restore rebuilds under the current format and compares with the current hash (measured in 1.5). (5) no flags; existing codes reused. (6) D101 row amended by the lead under delegation, surfaced on return. Ratification: owner on return.

<a id="r2"></a>
## R2 — Re-encoding walks every nodeKind/queryKind subtree through the codec before canonicalization (spike option B); the with/set-op branches get an in-memory oracle task

_lead · interpretation · basis 413/W2 (all 10 golden cases byte-identical, fixed point on all 16 current-format files, zero exceptions over 12 format-5 fixtures); 413/W3 (with/set-op never appear in any file-based oracle); design.md Q1 (ii) -- the current decoder's rules are the re-encoding · 2026-09-05T06:21Z · ratified: pending_

Ruling: (B). The per-kind canonicalize hooks cannot reach the expression/query subtrees; a generic, kind-agnostic decode->encode walk over the two discriminators is exactly "read under the current decoder's rules, then render as the current writer renders" (Q1), proven inert on every current-format file. Consequences: (1) upgradeSnapshot = walk + canonicalizeSnapshot + renderSnapshot; (2) a new task 1.1b: an in-memory oracle -- buildSnapshot over declarations holding a CTE view and a union/except/intersect view, rendered, walked, asserted a fixed point -- so the with and set-op dispatch branches are exercised (no file can); (3) the golden byte-identity table (task 1.1) stands as the primary oracle. Ratification: owner on return.

<a id="r3"></a>
## R3 — upgradeSnapshot takes the registry; a re-upgraded tip keeps one upgraded-from line holding the original hash -- stated in the delta

_lead · interpretation · basis 413/W1 (canonicalizeSnapshot takes a KindRegistry; a default registry would skip preset kinds' canonicalize); design.md Q3; su-reviewer's spec-only finding · 2026-09-05T06:22Z · ratified: pending_

(1) `upgradeSnapshot(raw, registry, requiredKeysByKind?) -> { text, fromVersion }` ratified: the registry is what makes preset kinds canonicalize, so the idempotence scenario holds for a Supabase snapshot too. (2) The migration-format delta gains the sentence and scenario: a tip upgraded again keeps exactly one `upgraded-from` line whose value is the hash the tip first recorded; the parser returns it. Applied by the planner before 1.3. Ratification: owner on return.

