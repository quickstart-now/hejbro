# Decisions — quickstart-now/hejbro#836

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — ld proposal approved; D1-D9 settled (codes unreadable/unwritable, current_user, one 23502 branch, tags in ledger.ts, migrate exit 2, reset delete to ledger code, measured path table, probe under read code, 42P01 tolerance kept)

_lead · interpretation · basis 412/D12, 412/D13, 412/R27 · 2026-09-04T21:02Z · ratified: pending_

Proposal approved under the owner's delegation (412 D12/D13); the nine open decisions of `harden-ledger-diagnostics` design.md are settled as follows. Rule: a failure the ledger owns is attributed to the ledger — never raw, never billed to a migration file.

- D1 codes: `apply-ledger-unreadable` / `apply-ledger-unwritable` (adjective, the sibling of `apply-ledger-occupied`; prefix = operation, not command). One merged code is refused: the two remedies differ and an automated caller must not parse prose.
- D2 role: name the role by one `select current_user` on the failure path only; if that read fails too, omit the role clause. The connection string does not reliably carry the user, and after `set role`/`security definer` the server's role is the one a grant must name.
- D3 wording: read and write texts as drafted in design.md D3; the write text names the write site in words (bootstrap / recording `<file>` / clearing the ledger rows) plus the common remedy, with exactly one SQLSTATE branch, `23502`, naming the identity/default the bootstrap creates. Every other state takes the general branch, the same discipline `execute.ts` keeps for `apply-failed`. `Next:` follows the marker rule (`check:next-marker`); new codes get their `skills/hejbro` reference entry in the same task (`check:diagnostic-xref`).
- D4 classification lives in `ledger.ts`: every statement it sends is wrapped so a failure carries a tag (direction, site) with the server error as `cause`; `execute.ts` reads the tag first and keeps `apply-failed` as the else branch. Future callers of `ledger.ts` inherit the rule.
- D5 `migrate` exits 2 on a ledger failure: the database did not refuse the migration (the transaction rolled back), so exit 1 would send a caller to a sound file. Migrations applied earlier in the run stay reported in the stdout bucket as today.
- D6 `reset`'s ledger-row delete refusal moves to the ledger code (D13 completeness: one path left under `reset-drop-failed` would keep the same defect under another name).
- D7 the path table is the measured one, not the brief's: probe (status, migrate, raise, reset), `readLedger` (status, migrate, raise), `isMigrationRecorded`/`bootstrapLedger`/`recordAppliedMigration` (migrate, raise), `clearLedgerRows` (reset). `verify` never touches the ledger — the brief's fifth command was the lead's guess and the measurement wins.
- D8 the identity probe's own failure takes the read code, saying the catalog read was refused; the promise "nothing reaches the user raw" then closes over the whole ledger path.
- D9 the 42P01 tolerance in `readLedger` stays (probe-to-read race only; the report "never applied" is true at report time). Measured (A2): a missing schema also answers 42P01, not 3F000, so there is no third face. Option ③ (skip `readLedger` when the probe says absent) is a defect-free structural improvement — recorded as reviewed and deferred in design.md, no issue.

<a id="r2"></a>
## R2 — scope: migrate's raw bootstrap failure is covered by the write code; 1.9 integration witness stays

_lead · interpretation · basis R1, 412/D13 · 2026-09-04T21:13Z · ratified: pending_

Measured (A4): with a role lacking privilege, `migrate` dies raw at the bootstrap `create schema` before any read. The issue text names `status`'s read only; the change covers the bootstrap write too, under the write code with the site named "bootstrap" (836/R1 D3/D7). Purpose-bound completeness (412 D13): the rule is "nothing the ledger owns reaches the user raw", and a scope narrowed to the issue's wording would leave the same defect one command over. 1.9's integration witness stays committed as a regression gate beside the one-off constructor review, as the ledger-identity change did (1.7/1.8 there).

<a id="r3"></a>
## R3 — ld (b) accepted at fb0003fa; reset clear failures move to the ledger code by rule (#753 intent stands); flake → #862; reviewer summoned

_lead · interpretation · basis R1, R2, 412/D13 · 2026-09-04T22:46Z · ratified: pending_

Group 1 (b) accepted at fb0003fa: 1.1–1.10, every gate green (test 93 files / 1119, test:types 2/2, integration 14 files / 81, validate valid, blackbox ok, diagnostic-xref 242 codes). (가) The move of `reset`'s ledger-clear failures — 42501, 55000 and the 42P01 TOCTOU row previously pinned under `reset-drop-failed` by harden-reset-and-verify (#753 / D106 R1 B1) — to `apply-ledger-unwritable` is the approved rule working, not a widening: attribution follows which statement failed (836/R1 D4/D6), the delta never conditioned it on a SQLSTATE, and a ledger delete that found no ledger is a ledger write that failed, not a drop. #753's intent (a rollback is never swallowed) stands; the delta states the sentence and the stale comment is fixed. (나) The advisory-lock witness flake is filed as #862 under #815; not touched here. Cost: 188 actual / 76 estimated minutes, of which ~55 were coordination (a placement correction crossing work in flight, three message crossings) — recorded as reconstructed in task-times.csv; the "command wiring / test reclassification" overrun pattern is noted for the next estimate. Reviewer summoned in constructor mode: delta and public surface only, roles without privilege and variant ledgers built by hand on postgres:17-alpine, built CLI, four checks (no raw object, header never the migration file, exit 2 vs 1, rollback real), detached worktree at fb0003fa.

