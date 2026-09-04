# Decisions — quickstart-now/hejbro#846

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch cp = #846 #820 #830 #831 as one change harden-config-paths-2, parallel to ck and so; #819 and #837 wait for ck

_lead · interpretation · basis D1 · 2026-09-04T16:53Z · ratified: pending_

Seventh batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the qy team dissolved: the second round on the init/config path files that `harden-init-paths` (#840, archived #847) left behind — #846 (the five D106 findings: read-side trailing separator answers differently from init, the config artifact's kind check runs before the ancestor walk, the nesting wording and its `Next:`, a dangling link on the read side reads as absent, an empty `--config` resolves to the cwd), #820 (a `migrationsDir` that is a file crashes `generate` with a raw ENOTDIR), #830 (the config-not-found `Next:` names `hejbro.config.ts` even under `--config`), #831 (the directory-at-config-path refusal repeats the file name) — four tracking issues, one change `harden-config-paths-2`, one PR. Files: `packages/cli/src/commands/init.ts`, `config.ts`, `loader.ts`, `snapshot-file.ts`, `path-probe.ts`, the migrations-directory listing and their tests — no overlap with ck (`packages/cli/src/check/*`, `commands/check.ts`) or so (`packages/core`, `packages/cli/src/contract/*`, `packages/query/src/client/{synthesize,contract-types}.ts`). #819 (every command honours `--config`, one root) waits: it touches `commands/check.ts`, which ck owns until it merges; #837 (`raise --file`) waits with it. Team cp = planner (fable), implementer (sonnet), reviewer (opus) in constructor mode (configuration files and a filesystem are foreign input, D110). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: one config, one answer, every refusal coded and naming the node that blocks).

<a id="r2"></a>
## R2 — harden-config-paths-2 approved; OD1 spelling refused at parse (invalid-config, stated code exception); OD3 two read-side codes via probePath; nesting wording

_lead · interpretation · basis D1, R1 · 2026-09-04T20:16Z · ratified: pending_

Proposal and delta of `harden-config-paths-2` approved under the delegation (#412 D12/D13 on dev): `validate --strict` valid; cli-commands ADDED 2, MODIFIED 3, every existing scenario kept; no diagnostics delta.
OD1 (NB2) — option A: a `snapshotPath` spelled as a directory (trailing separator, empty, a last segment of `.` or `..`) is refused at parse time with `invalid-config` by every command, the same rule as the absolute-looking value (#743). `init`'s code for that one input moves from `init-path-conflict` to `invalid-config` — a stated exception to the diagnostics code-stability rule, recorded in the proposal, because a spelling defect is decided before the disk is read and one config must get one answer. `migrationsDir` keeps every spelling.
OD3 (NB6 and the ancestor table) — option (a): two read-side codes stay — `snapshot-not-a-file` for a wrong kind at the path (a dangling link named with its target), `snapshot-unreadable` for what cannot be reached (a file or link ancestor, a permission, ELOOP) naming the node that blocks — decided by the shared `probePath` exactly as `init` decides it, the vocabulary per command.
OD6 nesting — the refusal names the kind held (a file cannot hold a file / a directory) and the `Next:` names what the user can change: the field, or the other field plus `--config` when the configuration file is one side; the existing snapshot-holds-migrations sentence stays byte-identical.

