# Decisions — quickstart-now/hejbro#846

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch cp = #846 #820 #830 #831 as one change harden-config-paths-2, parallel to ck and so; #819 and #837 wait for ck

_lead · interpretation · basis D1 · 2026-09-04T16:53Z · ratified: pending_

Seventh batch of the delegated queue (#412 D12/D13 on dev; #412/R1–R3), started as the qy team dissolved: the second round on the init/config path files that `harden-init-paths` (#840, archived #847) left behind — #846 (the five D106 findings: read-side trailing separator answers differently from init, the config artifact's kind check runs before the ancestor walk, the nesting wording and its `Next:`, a dangling link on the read side reads as absent, an empty `--config` resolves to the cwd), #820 (a `migrationsDir` that is a file crashes `generate` with a raw ENOTDIR), #830 (the config-not-found `Next:` names `hejbro.config.ts` even under `--config`), #831 (the directory-at-config-path refusal repeats the file name) — four tracking issues, one change `harden-config-paths-2`, one PR. Files: `packages/cli/src/commands/init.ts`, `config.ts`, `loader.ts`, `snapshot-file.ts`, `path-probe.ts`, the migrations-directory listing and their tests — no overlap with ck (`packages/cli/src/check/*`, `commands/check.ts`) or so (`packages/core`, `packages/cli/src/contract/*`, `packages/query/src/client/{synthesize,contract-types}.ts`). #819 (every command honours `--config`, one root) waits: it touches `commands/check.ts`, which ck owns until it merges; #837 (`raise --file`) waits with it. Team cp = planner (fable), implementer (sonnet), reviewer (opus) in constructor mode (configuration files and a filesystem are foreign input, D110). The lead approves the proposal and settles `[design]` decisions under the delegation, against hejbro's purpose (D13 on dev: one config, one answer, every refusal coded and naming the node that blocks).

