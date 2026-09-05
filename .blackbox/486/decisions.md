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

<a id="r9"></a>
## R9 — a failing batch is reported as a batch, never as one member's failure

_lead · interpretation · 2026-09-05T13:18Z · ratified: pending_

The batched path reported a failing context statement as the caller's own: `query execution failed for this "select" statement`, with `kind` and the statement text both naming the caller. The interactive path, which sends one statement at a time, names the failing statement correctly -- so the two paths diverged exactly where the delta says they agree. Neon's batch error carries no member index (already recorded in `packages/neon/src/http.ts`), so which member failed is not knowable: the report states what was sent and refuses to claim more. `code` stays `query-execution-failed` and `kind` stays the caller's operation kind -- the operation did fail; only the sentence was false. The message names the batch, lists every member in order, says the driver does not report which member failed, and preserves the driver's error as `cause`. The `rls-execution-context` delta gains one scenario for the batch report and one asserting the interactive path still names its single failing statement. Reopened as task 1.3b, marked `[design]`, red-first from a two-row input table (the failing member is a context statement / the caller's own).

<a id="r10"></a>
## R10 — task 1.3's missing red-first evidence is supplied by mutation

_lead · interpretation · 2026-09-05T13:51Z · ratified: pending_

Task 1.3's tests were written after the implementation, self-reported by the implementer. Rather than redoing the task, the evidence red-first would have produced is supplied by mutation: each of four mutations was applied to `packages/query/src/db/context.ts`, the query suite run, and the source reverted. Three conditions attach: the mutation table is recorded as a work entry (W1), the reopened task and every task after it hold to red-first, and the deviation is handed to the reviewer rather than left for them to find. The mutations also found a hole instead of merely confirming coverage -- with the path guard inverted, the "same statements, same order" identity test stayed green because both paths yielded `undefined` and the comparison passed vacuously; it now asserts that each path ran before comparing, and the mutation turns it red. That defect is of a kind red-first would not have caught, since red-first shows a test fails without the code, not that it fails under wrong code. Self-reporting the deviation is not penalised by reverting the work.

<a id="r11"></a>
## R11 — batch([]) sends nothing over the wire, not even the driver's own pins

_lead · interpretation · 2026-09-05T13:51Z · ratified: pending_

`batch([])` calls the client not at all and resolves an empty list -- the driver's own session pins are not sent either. The normal path cannot reach it (`runContextInBatch` always includes the caller's own statement), and `Driver.batch` is public surface, so a request to execute nothing must not carry a network side effect of its own. Measured: Neon's client sends whatever array it is given, empty included, and hands the empty result back -- so the refusal is a choice, not a limitation. The `driver-contract` delta states it in the batch requirement's own body.

<a id="r12"></a>
## R12 — rewriting #557's boundary test is admitted; D95 is unchanged

_lead · interpretation · 2026-09-05T13:53Z · ratified: pending_

#557's proposition -- a `renderContext` contribution alone does not widen a capability -- is still true, and its proper home is the query layer's own input table (task 1.3's "both `false`" row), not a fact about Neon. The Neon HTTP driver now carries a real capability declaration (`batched-transactions: true`), so it stands outside the boundary #557 drew for a driver declaring no relevant capability; its test was deliberately rewritten to assert the batch succeeds, per 486/R1. D95 is unchanged: a declaration is the truth and a contribution point does not widen one -- this change adds a declaration on top of D95 rather than bending it. Pending owner ratification.

<a id="r13"></a>
## R13 — the supabase preset's capability table is widened in this PR

_lead · interpretation · 2026-09-05T14:19Z · ratified: pending_

The only literal per-path capability table in the references lives in `skills/hejbro/references/supabase-preset.md`, not in `query-layer.md` as task 1.4 stated. A fourth capability key leaves that table incomplete, so it is widened here -- one column, `false` on both paths (`pgDriver` declares `false`; the pooler builds its own capability record and declares `false` under 486/R7). The file list is extended to reach it, on R8's reasoning: the update is the direct consequence of the declaration this change makes, and splitting it into a separate PR would leave a reference lying from the moment this one merges -- a stale skill is a broken user contract, not a docs nit. Task 1.4's own wording is corrected to name what exists: `query-layer.md`'s RLS section states the three branches, `supabase-preset.md`'s table gains the fourth column.

