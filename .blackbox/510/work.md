# Work — quickstart-now/hejbro#510

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — openspec 1.11.0 still validates a misspelled MODIFIED title; check-modified-titles catches it

_2026-09-05T05:03Z_

Measured 2026-09-05 in worktree feat-config-driver: appending XX to the MODIFIED title "Declarations can be checked against a live database" in add-config-driver's delta, `pnpm exec openspec validate add-config-driver --strict` prints "is valid", exit 0 (the same tool does refuse a MODIFIED block that omits a base scenario -- it finds the base requirement when the title matches, and silently treats a non-matching title as new). scripts/check-modified-titles.mjs: positive control (the same typo on a copied archived change) exit 1 naming the file and title; also refuses an ADDED title that already exists in the base; zero active changes exit 0.

