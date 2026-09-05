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

<a id="r4"></a>
## R4 — 1.6: a multi-command text folds by Array.isArray to the last command's rows, in one @hejbro/query function both drivers call

_lead · extension · basis 412/D24, D25; 486/R2; #891's own reasoning (no shared point but @hejbro/query); bt measurement on postgres 17 / pg 8.23 (array result per command, 42601 when params accompany a multi-command text) · 2026-09-05T11:24Z · ratified: pending_

Detection by Array.isArray(result) (the driver library's own signal), never by a missing rows field; the fold lives in one exported function beside statement-name.ts so the vanilla and Neon WebSocket drivers are alike by construction, tasks.md 1.6 file list amended; the handle/tx path's uncoded TypeError is one input row. The zero-length array case is ruled after the reachability measurement (empty text, comment-only, trailing semicolon). Ratification: owner on return.

<a id="r5"></a>
## R5 — R5 — split task 1.2 into 1.2a (pg, supabase, nile) and 1.2b (neon, after #458)

_lead · extension · 2026-09-05T11:49Z · ratified: pending_

Task 1.2 splits into 1.2a (pg, supabase, nile) and 1.2b (neon ws, neon http). The boundary is another piece's file ownership (`feat-config-driver`, #458, owns `packages/neon`), not work size: a required `batch` member breaks every driver value at once, so deferring all five would leave the repository red through tasks 1.3, 1.5 and 1.6, and a real regression would arrive invisible behind the known failures. After 1.2a the red is isolated to `@hejbro/neon`. TDD holds because each part starts from its own tier rows. The split stands even if #458 merges first -- the merge only clears 1.2b's waiting condition, it does not retract this ruling: reverting would churn the artifacts again, the two parts differ in kind (a mechanical declaration sweep against a real HTTP `batch` implementation with a recorded `HttpQueryable`), and the record of why the ordering moved is worth keeping for the archive.

<a id="r6"></a>
## R6 — R6 — a zero-length batch result array is an internal-invariant error, not an empty row list

_lead · interpretation · 2026-09-05T11:49Z · ratified: pending_

A zero-length result array from a multi-command text raises the internal-invariant error rather than resolving an empty row list. Measured against postgres:17: a semicolon-terminated single command, a comment-only text, an empty string and a double-semicolon text all answer with a non-array single result, and the earlier eight-row table shows the array path is taken only for two or more commands -- so a zero-length array is unreachable. The delta's "never `undefined`" guarantee already holds through the non-array path's `rows: []`. Follows the `lastResultOf` precedent in `packages/neon/src/http.ts`.

<a id="r7"></a>
## R7 — R7 — nile and supabase declare batched-transactions differently because they own different obligations

_lead · interpretation · 2026-09-05T11:49Z · ratified: pending_

The two decorators declare differently because they differ in what they own. `nileDriver` spreads a complete `Driver` and owns no execution path (a spread plus `renderContext`; the query layer applies the rendering on the batched path too, which is task 1.3's "same statements, same order" guarantee), so in the shipped configuration (Nile over pg) the declaration reads `false` and `batch` is inherited whole: its `src` changes not at all, and its obligation is verified rather than written. Its tier row is two lines -- over pg, `false` and `batch` throws; over a fake base declaring `true`, declaration and `batch` both inherited (the mechanism, pinned, test-only). The Supabase pooler builds its own capability record, so its member set must agree with its own declaration independently of the base: it declares `false` *and* overrides `batch` with the throwing stub, because an inherited `batch` under a `false` declaration is the hole "A capability explicitly declared false fails closed" forbids. Its tier row includes "over a `true` base, still `false`, still throws".

<a id="r8"></a>
## R8 — R8 — 1.2a/1.2b admit their own test fixture sweeps, not a separate task

_lead · extension · 2026-09-05T11:49Z · ratified: pending_

Task 1.2a's file list admits `packages/{cli,supabase,nile}/test/**` and 1.2b's admits `packages/neon/test/**`. Making `batch` a required member breaks every fake `Driver` literal in the test suites (33 in the CLI, 13 in Supabase, 2 in Nile, 1 in Neon); the sweep is the fourth key's direct consequence and belongs with the declaration that causes it. Split into a task of its own it would have no red to start from, which D88 forbids. All five `examples/*` packages stayed green throughout, since they use built driver values rather than assembling literals.

