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

<a id="r3"></a>
## R3 — cp (b) accepted at 9c95244d; D1/D5 details and the 1.2 order deviation ratified; #860 filed; reviewer summoned

_lead · interpretation · basis R1, R2, 412/D13 · 2026-09-04T22:31Z · ratified: pending_

Group 1 (b) accepted at 9c95244d: 1.1–1.6, every gate green (test 92 files / 1132, test:types 2/2, validate valid, blackbox ok, changeset patch). Ratified as design details, contract unchanged: (1) D1 — an empty `snapshotPath` is refused without echoing a bare `""` (the existing regression pin's spirit), `.`/`..` echo the value and suggest the default file name; (2) D5 — the two leaf kinds of the config path (directory, dangling link) share the loader's and init's sentence, the four ancestor kinds keep init's template, so `--config f/h.ts` and `migrationsDir: "f/mig"` refuse the same way; an absolute `--config` is echoed relativised in `config-not-found`'s Next (D57); (3) the 1.2 order deviation (source before test) was repaired by a stash-red verification and every later task submitted its red first — recorded, no further action. Estimates 57 → actual 335 minutes are recorded per row; the overrun corrects the next estimate, not this group. Out-of-piece finding (the bare-cwd hole in `stripAbsolutePrefixes`) filed as #860 under #815. Reviewer summoned in constructor mode: deltas and public surface only, hand-built config/directory/permission/link combinations, init vs read-side parity, stderr leak sweep, detached worktree at 9c95244d.

<a id="r4"></a>
## R4 — cp review round 1: B1/B3/B4 code repairs, B2 scenario sentence moves (OS code only when the OS refused); narrow re-review

_lead · interpretation · basis R3, 412/D12, 412/D13 · 2026-09-04T22:59Z · ratified: pending_

Constructor review at a92dc54b: BLOCKING 4 / NON-BLOCKING 3 / OK 9 (~330 runs, zero absolute paths / stack frames / uncoded errors in the new-code matrix). Rulings: B1 (`snapshotPath: "."` garbles the header on 6 of 9 commands — `ADJACENT_QUOTED_PAIR` in identity.ts matches across the new message's quotes) — code repair, in scope: the value is one of the four the scenario names and this change made it reachable. B2 (`migrations-dir-unreadable` omits the OS code when the ancestor is a regular file) — the code is right and the scenario sentence moves: an operating-system code belongs to a failure the operating system raised; an ancestor that is a regular file is a shape judgement by name, not an OS refusal, so the line names the node and its kind and carries no code. The delta's THEN is reworded to bind the OS code to the OS-refused alternative only (owner-delegated wording of an approved delta, 412 D12; intent — the user learns which node and why — unchanged). B3 (an absolute `--config` is rewritten into a cwd-depth-dependent `../..` chain in `Next:`) — code repair: the value echoed in the remedy is the value the user typed; D57's relativisation applies to paths hejbro discovered, never to a path the user gave (846/R3 item 2 is corrected on this point). B4 (`check:next-marker` red on init.ts:448/468, a scanner false positive over a shared builder) — the gate is the contract: repair by making the site scannable (a literal `Next:` at the site or the scanner's documented exemption form), never by weakening the scanner. NB1–NB3 per the planner's triage: in-scope wording goes in, neighbours file under #815. Narrow re-review on the four repairs only.

<a id="r5"></a>
## R5 — B3: the delta names the verbatim user-value echo as a Next:-only exception to D57; B2 third site (config-unreadable) moves too

_lead · interpretation · basis R4, 412/D13 · 2026-09-04T23:04Z · ratified: pending_

B3 refinement (reviewer's forward note): echoing an absolute `--config` value verbatim collides with the repository-wide rule that diagnostics carry no absolute paths (D57, cited at identity.ts). Ruling: the rule protects paths hejbro discovered on the machine; a value the user typed is the user's own and the remedy may hand it back. The delta names the exception explicitly — a user-supplied `--config` value is reflected verbatim in the `Next:` line only, never in the header or the body (which stay cwd-relative) — so the leak sweep allows exactly that echo and reports the allowance. The third B2 site (the `--config` requirement's `config-unreadable` sentence bundling "a file on the way / a dangling link on the way" into the OS-code clause) moves like the other two: kind judgements carry no OS code; permission, loop and listing failures keep theirs.

<a id="r6"></a>
## R6 — cp (c) accepted at 0d56b5d0: re-review 0/0/6; neighbours to #839 and #714; PR by the lead

_lead · interpretation · basis R4, R5, 412/D13 · 2026-09-05T00:32Z · ratified: pending_

(c) accepted at 0d56b5d0: narrow re-review BLOCKING 0 / NON-BLOCKING 0 / OK 6 — B1 header on 7 commands, B2 sentence↔behaviour 20/20 rows (kind judgements carry no OS code; EACCES/ELOOP/listing keep theirs), B3 typed value echoed verbatim and cwd-invariant, B4 `check:next-marker` green with zero exemptions and the scanner untouched, N1/N2 closed; leak sweep 557 lines 0/0/0 with the one permitted `Next:` echo verified as a real hit (`/private/tmp/nowhere/h.ts`). Full gates green on both sides. Neighbours: the `check:crap` contention flake goes to #839 with the measured load; the ELOOP corpus rows and the dirLabel spelling nit to #714 (no issue: same node, an accepted convention). Estimates 83 → actual 445 minutes recorded per row; two procedure deviations recorded (1.2 source-first, repaired by a stash-red check; the crap flake's load measured after the fact). Lead's next: rebase onto dev, gates, PR (Closes #846 #820 #830 #831), pin, merge, D106.

<a id="r7"></a>
## R7 — D106 round 1: B1/N1/N3 repaired at archive, B2 scenario text, N2 → #875; archived

_lead · interpretation · basis R6, 412/D13 · 2026-09-05T01:26Z · ratified: pending_

D106 round 1 (context-free, opus, dev 11aea799, uid 501, 72 trees / ~320 runs across nine commands): BLOCKING 2 / NON-BLOCKING 3 / OK 14. Disposition under the delegation (412 D12/D13): B1 — `generate` skipped the migrations-directory judgement on its no-changes exit, the one-tree-two-answers fault this change exists to end; repaired as group 3 (the listing moves before the first pass, two rows pinned). B2 — the nesting scenario's third input was unsatisfiable as written; the sentence now states the flagged configuration file exists, the shipped behaviour on that tree was already right. N1 — a typed `.`/`..` was answered with "remove the directory you are standing in", the exact remedy the empty-value rule exists to prevent; repaired (the remedy names the file to pass). N3 — the verbatim `--config` echo was bare, so a value with a space pasted back scaffolds a wrong project; repaired (shell-quoted when a shell would split or expand it). N2 (an unreadable configuration file reported with import advice) → #875: it needs a read-access probe on the leaf, its own small change. Archived.

