# Decisions — quickstart-now/hejbro#785

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — Adopt the folder-form recorder in hejbro, enforced by hooks and CI

_owner · 2026-09-04T03:52Z_

> Owner: "Register the blackbox work with the AI hooks so that it is handled only right before a PR is merged, and reflect this in the agent skills."

Decided: hejbro adopts the folder form under `.blackbox/`, with the `dd-blackbox` tool vendored at `.blackbox/bin/blackbox.mjs`; enforcement is the committed `.claude/settings.json` hooks and CI's first job, not AGENTS.md prose. The convention itself was settled in the same conversation and is recorded once, in quickstart-now/agent-skills#12 (D1–D24); this folder holds only what is specific to hejbro.

<a id="d2"></a>
## D2 — The blackbox CI job runs first and pins are checked both ways

_owner · 2026-09-04T03:52Z_

> Owner: "In CI the blackbox check should run first and the rest should follow only when it passes. And the blackbox CI must also check that the changed files' blobs match."

Decided: `ci.yml` gains a `blackbox` job that `verify` (and every future job) `needs`; on a PR it runs `check --pr N`, which verifies every pin against the PR head and every changed file against the pins.

<a id="d3"></a>
## D3 — Migrate the lead's ruling ledger in full

_owner · 2026-09-04T03:52Z_

> Owner, offered "extensions only", "everything" or "retire": chose everything.

Decided: all ninety rulings in `.agents/lead-rulings-0.2.x.md` (R1–R90, gitignored, Korean) move into their issue folders as `R#` entries classified by kind, so the 0.2.1 release gate (main issue #412) sees a real ratification queue instead of passing on an empty one. Separate issue and PR once this tool has landed.

<a id="d4"></a>
## D4 — hejbro is one item

_owner · 2026-09-04T03:52Z_

> Owner: "It is a system that splits when splitting is needed — the skills are split, hejbro is one unit, wasn't that the idea?"

Decided: one `.blackbox/` at the repository root; the `pnpm blackbox` script and the hooks point at it. The 78 single-file entries written before this change stay as they were, listed as legacy by the generated README.

<a id="r1"></a>
## R1 — #511 is superseded by blackbox check

_lead · interpretation · basis D2 · 2026-09-04T03:52Z · ratified: pending_

#511 asked CI to verify blackbox blob pins. `check --pr N` does that in both directions (every pin matches the PR head, every changed file is pinned) as the first CI job and as the pre-merge hook, so #511's ask is met by construction. Close #511 on merge with a pointer here; its `dc-blobs.sh` sketch is retired.

<a id="r2"></a>
## R2 — issue.sh start/close open and close the folder

_lead · interpretation · basis D1 · 2026-09-04T03:52Z · ratified: pending_

The owner's local `managing-hejbro-issues` skill already owns the issue lifecycle, so `issue.sh start N` now runs `blackbox new N` when the checkout is a feature branch (and prints the command when on dev/main, where the folder must not be created), and `issue.sh close N` runs `blackbox close N` when the folder is present. Best-effort: a failure there never blocks the issue operation.

