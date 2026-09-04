# Work — quickstart-now/hejbro#787

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Ledger R1–R91 migrated into nineteen issue folders

_2026-09-04T04:46Z_

The lead's ruling ledger (`.agents/lead-rulings-0.2.x.md`, gitignored, Korean) is migrated in full: 91 rulings plus the #750 split, 92 entries, each as an English rewrite with its original time (`--at`), a kind (interpretation 53, extension 37, stop 2) and its basis where the ledger named one. Folders were opened for every issue the ledger touches — #679 #686 #687 #697 #528 #531 #551 #552 #673 #744 #533 #752 #753 #754 #755 #750 and the umbrella #412 — with the merged PRs pinned from the GitHub API at their own heads (#733 #758 #739 #759 #770 #737 #760 #773 #775 #784 #780) and closed folders dated from the tracker. #533 stays `merged-pending` (its harness landed in #773 while the flake is unreproduced), which the release gate will surface as intended. Every extension ruling is `ratified: null`: this is the 0.2.1 release's ratification queue, listed per folder in the generated READMEs. Process rulings (team rules, slot discipline, permission-prompt findings) live under #412. The Korean ledger stays local as the source and is marked retired.

