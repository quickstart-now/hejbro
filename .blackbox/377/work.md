# Work — quickstart-now/hejbro#377

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-format-policy — the stability commitment, correctly framed (#377)

_2026-08-28T00:00Z_

Docs-only plain cycle, lead-direct, in worktree `fix-format-policy` off
dev `17b9b3e`, run in parallel with the gc2 and sk piece teams (no file
overlap).

### What lands

Decision-log row **D101**: pre-1.0 bumps allowed on shape change
(v4→v5→v6 precedent) under two standing guarantees — migrations never
rewritten by a bump (tip verify banner only), and version asymmetry
always loud (older reader refuses via D73; newer reader regenerates
silently). From 1.0, a bump is at most a minor-version changelog
event. No upgrade command exists or is planned. A user-facing section
in `docs/guide/getting-started.md` states the same guarantees.

The "tip banner only" phrasing incorporates the gc2 team's measured
correction of v6's own blast-radius claim (a committed chain pinned by
verify banners does see its tip banner move) — the policy text is
written against that measurement, not the earlier optimistic wording.

Migrated from the single-file entry `.blackbox/2026-08-28-fix-format-policy.md`, kept verbatim at `.blackbox/377/artifacts/2026-08-28-fix-format-policy.md`.

