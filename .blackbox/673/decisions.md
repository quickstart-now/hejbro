# Decisions — quickstart-now/hejbro#673

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The measurement protocol is approved as registered

_lead · interpretation · 2026-09-03T12:50Z · ratified: pending_

Ledger R38.

ti's registered protocol is approved: L1 synthetic CPU load, verdict = three of three green and a three-run maximum wall clock within 1.25× of base, no post-hoc statistics. The #744 regression pin takes the cheap form only (no follow-up issue for a broad helper or source scan). #730's 120 s is tried back at 30 s in G3.2; if that fails, closed with the reason in the PR body.

<a id="r2"></a>
## R2 — ti intervention: slot handover after a-L2, candidate a eliminated on arithmetic

_lead · interpretation · basis R38 · 2026-09-03T16:55Z · ratified: pending_

Ledger R51.

Base at 16 burners: 3/3 green (~205 s); candidate a at L1: 812 s (4×). (1) after a-L2 the slot is handed over temporarily (qc reviewer's gates) and resumed; (2) a is eliminated by rule 2's arithmetic, L3 skipped and recorded in advance; (3) rule 5 applies to base only at 32 burners three times — if still 3/3, conclude "not reproducible under synthetic load" and choose by rules 2 and 3 plus the structural argument.

<a id="r3"></a>
## R3 — At 32 burners the base fails to reproduce: two 30 s timeouts in the tsc-spawning test

_lead · interpretation · basis R38 · 2026-09-03T14:20Z · ratified: pending_

Ledger R54.

ti's measurement: at 32 burners (load about 160) the base fails — two cases of `packages/cli/test/declare-emit-callback-shadow.test.ts` time out at 30 s (real tsc spawn), everything else passes, both runs identical. Candidates b and c are measured at 32 burners (not 16); admission is this file's survival. The failure body was captured for the first time, closing #673's open question.

<a id="r4"></a>
## R4 — Stage 1 verdict: candidate c alone survives

_lead · interpretation · basis R38 · 2026-09-03T14:40Z · ratified: pending_

Ledger R55.

Table: base16 3/3 pass (203–218 s); a16 3/3 pass (757–812 s); base32 0/3 (two timeouts in `declare-emit-callback-shadow.test.ts` at 192 and 249, 30000 ms); b32 0/3 (one timeout at 192); c32 3/3 pass (301–310 s; median 302 versus base32 279 = 1.08×). Verdict: base and b fail rule 1; c — the two tsc-spawning files split out as `*.types.test.ts` with a root `test && test:types` run serially afterwards — is the only admission. a exceeds rule 2 by 3.5× at 16 burners and is not re-measured at 32 (a deviation for ratification: single-worker serialisation can only get longer as load rises). Rule 5 procedure: a dated amendment paragraph in the protocol (six runs taken under the old rule, strengthened to 32 burners, why a was not re-measured). Stage 2's U series runs base and c only, three runs each.

<a id="r5"></a>
## R5 — Candidate a is closed on argument; the capture harness stays on; G3.2 merged into G3.1

_lead · interpretation · basis R55 · 2026-09-03T15:15Z · ratified: pending_

Ledger R58.

The gap on candidate a is ratified by argument: `fileParallelism:false` loses most on an idle machine, so its U ratio is at least the 3.7× seen under load — over rule 2's 3× ceiling; closed, not deferred. Mechanism confirmed: every failure in fifteen runs was `declare-emit-callback-shadow.test.ts` (tsc spawn, the 30 s ceiling package); under c32 the same case took 9.9/16.9/17.4 s, a 1.7× margin, so §7's "contention removed" wording is allowed. G2 defect (i): the `packages/cli/vitest.config.ts` setupFiles comment contradiction — make the harness always-on and fix the comment (a harness that is off when needed is pointless); one mechanism only, never reporter wiring and setupFiles both. (ii) transcript capture (argv, cwd, exit, stdout, stderr of runCli and git calls; successes recorded, dumped only on failure, reset per test to bound memory) = G2.3b approved. G3.2 folds into G3.1: c plus the 30 s revert in one commit, three runs at 32 burners on the real tree (final verification doubling as the #533 capture attempt); if not 3/3, restore 120 s and rerun three times once, reason in the PR body.

<a id="r6"></a>
## R6 — Half of G3.2 reverted: three tsc-spawning files, not two

_lead · interpretation · basis R58 · 2026-09-03T15:20Z · ratified: pending_

Ledger R59.

ti's planner found that §2 of the protocol counted two tsc-spawning files where there are three (`examples/cli-smoke/test/vendored-contract.test.ts` was missing — 24.2 s at c32, 1.24× of 30 s, the very suite that produced #730). No run is invalidated (§4–7 do not depend on the count); a correction paragraph goes into the protocol. Verdict: option A — only `vitest.types.config.ts` gets 30 s, `examples/cli-smoke/vitest.config.ts` keeps 120 s (numbers in the PR body). Option B (vendored-contract into two phases too) would reopen rule 2's measurement and is rejected. No follow-up issue (#730's ceiling stands as the treatment, in the owner's #220 spirit). The AGENTS.md line names all three files.

<a id="r7"></a>
## R7 — ti close-out: c lands, the single-file 32-burner loop is declined, #533 stays open

_lead · interpretation · basis R55 · 2026-09-03T16:30Z · ratified: pending_

Ledger R60.

Final verification: G3.1 f4c9a7a6 (c plus types at 30 s, cli-smoke at 120 s), three runs at 32 burners on the real tree 3/3 (305/322/379 s), zero capture markers. `changeset status` reports nothing missing, so no changeset. (4) the single-file ten-run loop at 32 burners is declined: #533's own text says the file passes 6/6 when run alone, so that is not the reproduction condition; a faithful reproduction is the whole cli suite repeated, about 45 minutes of slot at 63%. #533 stays open with the harness landed and the flake unreproduced. G4.2: no new work (#709's `rm -f -v` plus self-detection of leftover volumes with command guidance already exist; #220 spirit).

