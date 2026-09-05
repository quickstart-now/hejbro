# Work — quickstart-now/hejbro#497

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Gate output now states what it did; fresh forced run shows the byte-identical verb

_2026-09-05T05:08Z_

2026-09-05, worktree chore-crap-wording, `pnpm check:crap --force` (exit 0): "update-crap-readme: README.md left byte-identical (numbers unchanged; nothing to commit) -- 0 of 1677 functions over CRAP 5, highest 5.00, measured at 36c4e1ac". The two other verbs -- "REWRITTEN to HEAD's block (numbers unchanged; the working copy carried a different stamp -- commit or discard README.md)" and "REWRITTEN (scanned A->B, over C->D, highest E->F -- commit README.md)" -- replace "restored from HEAD (numbers match)" / "refreshed"; the failure line of check-crap now names the turbo coverage replay as a possible cause and the --force rerun as the remedy. Read of the current code: the "unchanged" verb was already reserved for the byte-identical case (#574 added the restored case), so the remaining defects were the missing movement and the unnamed cache.

