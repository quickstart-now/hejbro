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

<a id="r4"></a>
## R4 — ld review round 1: B1 read-before-bootstrap, B2 no 42P01 tolerance inside a transaction, B3 pg pool error listener (scope extension), B4 column-specific hint; group 2, narrow re-review

_lead · extension · basis R1, R3, 412/D13 · 2026-09-04T23:13Z · ratified: pending_

Constructor review at 1351d507: BLOCKING 4 / NON-BLOCKING 3 / OK 12, every gate green. Rulings, all code repairs in a group 2 with narrow re-review:
- B1 — `migrate` bootstraps before it reads, so a ledger it may not read is reported as an unwritable bootstrap; `raise` reads first and answers correctly. Repair: `migrate` probes and reads before any bootstrap write, like `raise` (one order for the two apply paths); the scenario's input (select withheld / usage withheld) then answers `apply-ledger-unreadable` on both.
- B2 — a ledger dropped concurrently mid-transaction makes `migrate` report `apply-failed` naming a file with 25P02 and exit 1. `readLedger`/`isMigrationRecorded`'s 42P01 tolerance inside an already-aborted transaction is the hole; `clearLedgerRows` handles the same race correctly. Repair: inside a transaction the ledger statements never tolerate 42P01 (a ledger that vanished mid-run is a ledger write that failed: `apply-ledger-unwritable`, exit 2, rolled back); the tolerance stays only on the pre-transaction read where "absent" is a state.
- B3 — connection loss during the ledger read reaches the user as a raw pg stack through an unhandled pool 'error' event. The delta names this input ("a failure carrying no server code at all") and is right; the product is wrong at `@hejbro/pg`'s pool, which attaches no error listener, so the failure is a crash rather than a rejection the classifier could see. Scope extension (recorded, 412 D13: nothing the ledger owns reaches the user raw): the driver attaches the pool error listener so an idle-client error becomes the query's rejection, and the ledger classifier renders a code-less failure with the driver's message. The fixed changeset group already covers `@hejbro/pg`. Not a driver-contract change (the contract never promised a crash).
- B4 — the 23502 hint claims the bootstrap declares any refused column `bigint generated always as identity`; false for `applied_at` and for extra columns the identity rule allows. Repair: the hint names the bootstrap's declaration for the column the driver reports (`id` → identity; `applied_at` → its default; any other column → "a column the ledger's bootstrap does not declare"), never a blanket claim.
NB1–NB3 per the planner's triage: in-scope wording goes in, neighbours come to the lead for #815.

<a id="r5"></a>
## R5 — B3: option A stands; defect size recorded as #864 (closes with this PR); NB3 → #865; 2.5 wording accepted

_lead · interpretation · basis R4, 412/D13 · 2026-09-04T23:16Z · ratified: pending_

On the planner's B3 options: A stands (836/R4), not C. The delta's sentence — no failure the ledger owns reaches the user raw, a failure carrying no server code included — is right, and the reviewer constructed exactly that input; under C the archive review would find the same contradiction again, and a spec sentence a known input contradicts is not a spec. A is not the ledger piece shrinking the problem: the defect's real size (every command, every query through the pg driver) is recorded as #864 under #815, fixed at its own location (`packages/pg/src/driver.ts`, pool error listener + a pg unit test), and that issue closes with this PR. B is refused for the reason the planner gave. 2.5's wording (the file's statements ran in the same transaction and rolled back with it; no file kind named) is accepted as removing a false statement, not a new decision. NB3 (forced RLS makes the ledger lie) filed as #865 under #815. The corpus list (16 items) goes to #714 by the lead once the planner forwards the reviewer's text in (c).

<a id="r6"></a>
## R6 — B2 clarification: the statement decides — a ledger that vanished at the in-transaction recheck is apply-ledger-unreadable, at the insert apply-ledger-unwritable; exit 2 and rollback either way

_lead · interpretation · basis R4, R1 · 2026-09-04T23:17Z · ratified: pending_

R4's sentence named the write code for a ledger that vanished mid-transaction; the statement that fails first is the recheck select (direction read, site recheck). The rule this change keeps everywhere (D4/D6: which statement failed decides, never the SQLSTATE or the surrounding activity) applies unchanged: vanished at the recheck → `apply-ledger-unreadable`; vanished at the insert → `apply-ledger-unwritable`. Exit 2, rollback and the ledger as identity are the same in both. No delta change; B1 was exactly a same-situation-different-code defect and an activity-based exception here would reintroduce it on another axis.

<a id="r7"></a>
## R7 — ld (c) accepted at fde2aea0: re-review 6/6; role-name omission on dead connections stays; #870 filed; corpus to #714; PR by the lead

_lead · interpretation · basis R4, R5, R6, 412/D13 · 2026-09-05T01:09Z · ratified: pending_

(c) accepted at fde2aea0: narrow re-review confirmed all six (B1–B4, NB1, NB2), 0 new BLOCKING, gates green (integration 14 files / 83). The reviewer built the adversarial inputs the repairs claimed to cover — the grant that flipped B1's code, a `pg_sleep` migration to land inside the recheck window for B2, `pg_terminate_backend` (a served 57P01, rendered) and `docker kill` (the genuinely code-less failure, rendered as "Connection terminated unexpectedly") for B3, a trigger nulling `origin` for B4 — and none contradicted a scenario. Recorded facts: inside `migrate`'s transaction only the read branch of the vanished-ledger rule is reachable (the recheck's ACCESS SHARE lock holds a concurrent drop off until commit); the write branch is reached by `reset`'s clearing — one rule, two branches, not every branch on every command. Planner's judgement on the new non-blocking (connection-loss diagnostics omit the role name) is accepted: D2 refused the connection-string user for the same reason, and an unverifiable claim is worse than an absent clause; the live-connection scenarios carry the role. The two measurement-driven corrections (two listeners, not one; the reviewer's reproduction is the 57P01 path, not the code-less one) stand as written in the tasks and W entries. #864 gets its folder (W1) and closes with this PR. Neighbours: docker contention/orphans filed as #870; the corpus list (19 rows) left on #714; `generate-command.test.ts` flakiness observed once — no issue until it repeats. Cost recorded per row (group 1 188/76, group 2 183/47) with the planner's own attribution. Lead's next: rebase onto v3 dev, gates, PR (Closes #836 #823 #864), merge, D106.

<a id="r8"></a>
## R8 — D106 round 1: B1 (dead client discarded, role on a fresh connection), N1 (listener once per client), N2 (remedy by reason class), N3/N5 sentences repaired; N4 = #865; archived

_lead · interpretation · basis R7, 412/D13 · 2026-09-05T01:58Z · ratified: pending_

D106 round 1 (context-free, opus, dev 36c4e1ac, PostgreSQL 17.11, 26 constructed states across 24 databases): BLOCKING 1 / NON-BLOCKING 5 / OK 15. Disposition under the delegation (412 D12/D13): B1 — the read diagnostic lost the role after a terminated backend because the dead client went back into the pool and the classifier's `select current_user` ran on it; repaired in `@hejbro/pg` (a client whose statement failed with a connection-class code, 57P01–57P03, or no code at all is discarded on release) and the requirement now states the role is read on a fresh connection and omitted only when no connection can answer. N1 — the per-checkout error listener leaked into Node's MaxListeners warning on a healthy five-migration run; repaired (once per client object). N2 — every read remedy was permission-shaped; repaired (rerun for a dead connection, a cancelled statement or a code-less loss) and the sentence says so. N3/N5 — two sentences corrected (nothing recorded *for that file*; no statement *from any file* was sent). N4 → #865. All inside hejbro's purpose: a diagnostic that names what it can name and a remedy that fits. Archived.

