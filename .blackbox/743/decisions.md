# Decisions — quickstart-now/hejbro#743

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D2: an absolute-looking artifact path is refused with invalid-config; the re-rooting scenario is retired as REMOVED + ADDED

_lead · extension · basis D1 · 2026-09-04T13:07Z · ratified: pending_

D2 (#743) — option a: `parseConfig` refuses an absolute-looking `migrationsDir`/`snapshotPath` with `invalid-config`, naming the field, for every command at once — which also removes the `verify` `Next:` that would tell a user to `rm /db/migrations/…`. This replaces the previous change's pin that `/db/migrations` is silently re-rooted under the cwd: a committed config carrying a root path is a mistake, and re-rooting it is what #743 reports as "two names for one file". Because a shipped scenario changes, the old scenario is retired as REMOVED and the refusal added as ADDED — never edited in place under MODIFIED (OpenSpec: a MODIFIED delta cannot drop or rename a scenario). Options b (display alignment while keeping the re-rooting) and c (honour the absolute path, against D57) are rejected. Relative spelling variants (`./db/mig` vs `db/mig/`) stay as they are: both name a real node.

