Refs:
- docs/specs/2026-08-19-hejbro-design.md @ blob 3a78c11927e0d0bee4cb1cb2126e3ac4711aeb57
- docs/guide/getting-started.md @ blob 3096bbbfa9eb737eaf588ac622d73e6f745b3ed8

# fix-format-policy — the stability commitment, correctly framed (#377)

Docs-only plain cycle, lead-direct, in worktree `fix-format-policy` off
dev `17b9b3e`, run in parallel with the gc2 and sk piece teams (no file
overlap).

## Owner inputs (English rewrites)

The item originates in the owner-supplied external AI review (finding
10: "commit to a `hejbro snapshot upgrade` command before 1.0"). The
lead's verification reframed it — under the declaration-is-truth model
a snapshot is a derived artifact that regenerates on the next
generate, so an upgrade command has nothing to migrate; the real
missing piece was a WRITTEN stability policy. The owner adopted the
item set into the #282 gate ("0.2.0 slipping is fine") with the
root-cause orientation, and approves this row via the PR's merge.

## What lands

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
