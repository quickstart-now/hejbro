# Decisions — quickstart-now/hejbro#750

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The first external report is split into six sub-issues under #412

_lead · interpretation · basis D110 · 2026-09-03T15:10Z · ratified: pending_

Ledger split-750.

#750 is the first external field report (hejbro-assist, 0.2.0-pre.0 on PG18, Neon, Nile and Supabase). It stays as a Task/bug sub-issue of #412 holding the report, and is split into #752 (verify skips preset validators, Bug) · #753 (reset dependency order plus the hidden ledger failure, Bug, top priority) · #754 (Nile 42622 on three-part references, Bug) · #755 (check cannot compare on Nile without EXPLAIN, Bug) · #756 (skills add installs internal skills, Task) · #757 (issue template, Task). The processing order is announced in a comment.

<a id="d1"></a>
## D1 — Owner input 1

_owner · 2026-09-04T00:00Z_

"Let's pick up where we left off."

<a id="d2"></a>
## D2 — Owner input 2

_owner · 2026-09-04T00:00Z_

"Last time it stopped on a permission request while running these exact
commands" — a `cd <worktree> && rg … packages/…` batch.

<a id="d3"></a>
## D3 — Owner input 3

_owner · 2026-09-04T00:00Z_

"I delegate authority. Process #750 first, then #412 in order."

<a id="d4"></a>
## D4 — Owner input 4

_owner · 2026-09-04T00:00Z_

"Only let rc and nl finish, save the session memory, and downgrade the
brew-managed Claude Code to 2.1.258." Then: "Uninstalling the cask is too
risky." Then: "Just leave it; no downgrade." Then, after 2.1.260 appeared
with the revert: "I'll wait for the bot's brew bump and upgrade myself;
from the next session we verify the bug is gone."

<a id="d5"></a>
## D5 — Owner input 5

_owner · 2026-09-04T00:00Z_

"The rc work has no blackbox entry — did that move to CI?"

