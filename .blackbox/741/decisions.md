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

<a id="r3"></a>
## R3 — Review disposition: three blockers fixed here, #767 absorbed, undo by this run's record, shared path-probe; round 2 passed

_lead · interpretation · basis D1, R1, R2 · 2026-09-04T15:55Z · ratified: pending_

Constructor-mode review, two rounds (0311225f → 90131b09). Round 1 found three blockers only through constructed inputs while every gate was green: a read-only parent (chmod 555) leaked a raw EACCES stack and left `mig/` behind; an unreadable snapshot file leaked raw stacks from four read-side commands; a dangling symbolic link at an artifact path was written through and reported as created. Ruled (D13 on dev — init makes my project where I said, and only what I said): all three fixed in this change, #767 absorbed into the batch (its own folder opened locally with W1). Settled along the way: `snapshot-unreadable` for a file that cannot be read, kind check first so an unreadable directory is `snapshot-not-a-file`; undo removes only what this run created, never what it found; the read-side blocked-ancestor stat is decided exactly as `init` decides it through the shared `path-probe.ts`; the ELOOP `Next:` no longer says "permissions". Two artifact repairs ratified (the 1.3 table follows the design order; "a file cannot hold a directory"); the round-trip scenario's WHEN names where the declarations sit. Round 2 passed: undo split confirmed by a contrast pair, dangling links refused at four positions, 38 stderr lines with no absolute path, stack frame or uncoded error. Carried over to #815: #830, #831.

<a id="r4"></a>
## R4 — D106 round 1 disposition: wording NB1/NB4/NB7 repaired at archive; NB2/NB3/NB5/NB6/NB8 → #846 next batch; archived

_lead · interpretation · basis D1, R3 · 2026-09-04T16:36Z · ratified: pending_

D106 round 1 (context-free, opus, dev 2b7fd901, 63 failing runs swept for leaks: 0 absolute paths, 0 stack frames, 0 uncoded errors): BLOCKING 0 / NON-BLOCKING 8 / OK 13. Disposition under the delegation: three wording findings repaired at the archive (NB1 trailing separator on a file path is refused not honoured; NB4 the artifact label keeps the full path while the reason names the blocking directory; NB7 link targets are spelled relative to the cwd); five code findings (NB2 read-side trailing separator answers differently from init, NB3 config artifact kind check before the ancestor walk, NB5 nesting wording and Next, NB6 dangling link on the read side reads as absent, NB8 empty --config resolves to the cwd) are inside hejbro's purpose — one config, one answer, coded refusals — and go to #846 as the next batch on these very files together with #819/#820/#830/#831, rather than a lead-only correction round while three teams run. Archived.

