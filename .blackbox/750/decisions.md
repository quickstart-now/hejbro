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

<a id="d6"></a>
## D6 — Finish everything under #750, then release 0.2.0-pre.1

_owner · 2026-09-04T07:21Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#34_

"Now handle everything related to #750. After that we release the pre.1 version."

Scope as read by the lead: the two open D106 rounds (`harden-reset-and-verify`, `fix-nile-findings`) go through their round-2 verdicts to archive, #750 closes, and the lead prepares the 0.2.0-pre.1 release up to the owner's four release steps (Version Packages PR CI approval and merge, dev → main merge commit, npm environment approval).

<a id="d7"></a>
## D7 — Same delegation as before

_owner · 2026-09-04T07:21Z · raw ef19f294-a4fc-4e10-8c65-c2c2a109dcb4#35_

"The way of handling it is the same: delegation."

The lead rules where the written rules are silent, records each ruling as `R#` in the item's `.blackbox/` with its kind and basis, and the extensions queue for ratification (D3 in this folder; the ratification evaluator path settled in the blackbox v2 design, `.blackbox/785/`).

<a id="r2"></a>
## R2 — fix-nile-findings D106 round 2 disposition: N1 repaired as an interpretation of step 5, N2/N3 repaired, N4 owner-gated (#800), archived

_lead · interpretation · basis D2, R1 · 2026-09-04T07:21Z · ratified: pending_

Round 2 (context-free, opus, at dev `adb916c4`): BLOCKING 0 / NON-BLOCKING 4 / OK 20.

- R2-N1 said step 5 (a type cast the server appended to a string literal) stripped only a single-word type name, so `'{}'::text[]`, `'x'::character varying` and `'…'::timestamp with time zone` survived, and framed widening as an owner call because it "changes the enumerated list". Ruling: it does not. The enumerated item is "a type cast the server appended to a string literal"; the server spells that cast with `format_type` (array brackets, two-word names, typmods, time-zone suffix, qualified or quoted names), so recognizing the whole spelling is the item as written, and no new step is added. Repaired with a twelve-row table, including the negative rows (`'a'::text and b` keeps `and b`; `null::text[]` is not a string literal).
- R2-N2 (the text-mode `Next:` named `pg_get_constraintdef`, a function `check` never calls) and R2-N3 (`nile-preset.md` cited a `cli-commands` heading that does not exist) are wording repairs, pinned by tests — the doc test now reads the cited heading back and checks the main spec carries it.
- R2-N4 (decision log D99 contradicts the shipped by-table rendering) is owner-gated: filed as #800 under #412; the archive proceeds with it as an archive note.

No finding contradicts a delta scenario, so the archive gate is passed; `fix-nile-findings` is archived at this disposition in the PR that also closes #750.

