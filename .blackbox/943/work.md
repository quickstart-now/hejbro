# Work — quickstart-now/hejbro#943

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — re-vendor blackbox.mjs with the max-plus-one numbering

_2026-09-07T13:53Z_

The fix landed in the canonical `dd-blackbox` skill first (quickstart-now/agent-skills#34, PR #35, merge 2ade64c; formatter follow-up #36, PR #37, merge 462a6b3): `nextId` is one past the highest number on record for the prefix in `meta.json`, never the entry count, and an id whose anchor or `## <id>` heading the target file already holds is refused (exit 1, message naming the id and the file, nothing written). The skill's own suite pins it with one input table over `D`/`R`/`W`: two entries, the second renumbered 2 to 4 in meta and file, the third add yields 5 where the old rule yielded 3 (measured); a hand-written entry 6 makes the next add refuse and leaves both files unchanged (23/23 on node 22). This PR re-vendors the script with `blackbox init --update` from the canonical checkout; the vendored copy is byte-identical to the canonical (`diff` empty), `TURBO_FORCE=1 pnpm check` and `pnpm blackbox check` pass on it. No hejbro folder currently holds a gap (`.blackbox/412` has R1 to R36 contiguous after the hand repair the issue describes), so nothing on record changes.

