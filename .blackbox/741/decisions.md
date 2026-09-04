# Decisions — quickstart-now/hejbro#741

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch ip = #741 #743 #766 #768 as one change harden-init-paths, parallel to li; #745 #767 follow on the same files

_lead · interpretation · basis D1 · 2026-09-04T12:52Z · ratified: pending_

Second concurrent batch under #412 D11 (parallel where independent) and #412/R1–R3: the init path bugs #741 (`--config <path>` ignored by `init`), #743 (`init` and `generate` name the same file two ways), #766 (nested migrationsDir/snapshotPath pass the duplicate check, then EISDIR) and #768 (the stat-failure `Next:` names the missing leaf, not the blocking ancestor) — four bugs, one change `harden-init-paths`, one PR, tracking issues = the bug issues. #745 and #767 (raw stacks from config and EACCES) share `init.ts`/`config.ts` and follow as the next batch on the same files, never in parallel with this one. Files: `packages/cli/src/commands/init.ts`, `packages/cli/src/config.ts` and their tests — no overlap with the li batch (`apply/*`, `commands/migrate|status`) or the co batch (`packages/core`). Team ip = planner (fable), implementer (sonnet), reviewer (opus) in constructor mode (the input is configuration files and a filesystem — foreign input, D110). The lead approves the proposal and settles `[design]` decisions under the owner's delegation (#750 D3/D7).

<a id="r2"></a>
## R2 — harden-init-paths approved; D1: root = cwd, --config names the file only; every-command config-relative goes to a follow-up

_lead · interpretation · basis D1, R1 · 2026-09-04T13:07Z · ratified: pending_

Proposal and delta of `harden-init-paths` approved under the owner's delegation (#750 D3/D7): `validate --strict` valid; cli-commands ADDED 1 (a configured artifact path is relative to the working directory) and MODIFIED 1 (init) with every existing scenario kept and five added; no diagnostics delta (D5 — the diagnostics spec does not enumerate codes; the one new code from D3b needs no delta).

D1 (#741) — option A: the project root is the working directory; `--config <path>` names the file only — read if present, else written there — and every label stays cwd-relative, which is exactly how `generate --config X` treats the same file, so the "same interpretation as the consuming commands" SHALL holds by construction. Option B (init alone config-relative) would break that SHALL and re-open #687; option C (every command config-relative) is the right long-term shape but touches `migrate`/`status` (the li team's files) and four other commands — filed as a follow-up together with the planner's findings ① and ②. Sub-points accepted: export `resolveConfigPath` from the loader unchanged, `runInit(cwd, rawArgs = [])` shaped like `runHistory`, `--config=<path>` accepted.

