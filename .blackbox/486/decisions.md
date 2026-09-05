# Decisions — quickstart-now/hejbro#486

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — A fourth capability, batched-transactions, with a batch member; a context runs as one batch where interactive transactions are absent

_lead · extension · basis 412/D24, D25; D95 (a truthful capability set names what a driver can do); the #300/#486 measurement (Neon HTTP sql.transaction batch applies set local role + set_config atomically, no leakage); the HTTP driver's existing throwing transaction() precedent · 2026-09-05T08:26Z · ratified: pending_

Design (design.md Q1-Q5): a named capability rather than a buffered fake of transaction(callback); the driver's declaration alone picks the path (interactive wins, batched serves, neither → one error naming both keys); batch(statements) returns one row list per member, atomic, required on Driver with a throwing implementation on false; as(context).transaction(cb) stays interactive-only; the tier check gains a batched leg. driver-contract MODIFIED ×3 + ADDED; rls-execution-context REMOVED ×2 + ADDED ×2. Sequenced after add-prepared-statements archives (shared "exactly N keys" sentence — re-check the delta at merge-in). Ratification: owner on return.

<a id="r2"></a>
## R2 — #891 (one exported name helper) and #892 (multi-command text = last command's rows) fold into add-batched-transactions

_lead · extension · basis 412/D24, D25; same files (driver contract, pg, neon); refusal rejected because a multi-command text is only detectable after it ran; psql precedent · 2026-09-05T08:29Z · ratified: pending_

Tasks 1.5/1.6 added; driver-contract ADDED requirements for the helper export and the last-command rule. Ratification: owner on return.

<a id="r3"></a>
## R3 — Kick-off rulings: existing error/test files, an any-of assertCapability with an N-key message, a batch-per-execute session inside context.ts, and 1.2 deferred until #458 lands

_lead · interpretation · basis 412/D24, D25; 486/R1, R2; bt (a) report (tasks.md named files that do not exist; scopedRun's session-shaped callback; SETUP_SESSION_SQL is itself a multi-command text) · 2026-09-05T11:20Z · ratified: pending_

Q1 the lead's file names were shorthand — errors.ts and test/driver/{contract,errors}.test.ts are the files, tasks.md corrected in place. Q2 assertCapability takes keys (any-of), single-key message byte-identical, multi-key message in the N-general form, error gains a `capabilities` field. Q3 the batched path hands `send` a batch-per-execute session so the change stays inside context.ts; the one-statement invariant is pinned. Q5 order 1.1 → 1.3 → 1.5 → 1.6 → 1.2 → 1.4, neon untouched until PR #909 merges and the lead rebases. Ratification: owner on return.

