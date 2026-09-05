# Decisions — quickstart-now/hejbro#303

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Prepared statements ship as an opt-in third capability; the design forks are settled by the lead

_lead · extension · basis 412/D24, 412/D25 (full delegation, no deferral); D95 (capability-gated driver behaviour); the archived measurement record (extend-query-runtime, 50/50 positive runs, 6.6-8.4%); Supavisor's named-prepared-statement support being flag-gated (github.com/supabase/supavisor/issues/69, supabase.github.io/supavisor/faq) · 2026-09-05T04:29Z · ratified: pending_

Disposition: implement, not close. The record shows the capability small, not wrong, and 412/D25 rules deferral out. Design forks settled (openspec/changes/add-prepared-statements/design.md Q1-Q6): (1) a third capability key `prepared-statements`, closed union, every fake moves with it; (2) opt-in — `pgDriver(x, { preparedStatements: true })`, `neonDriver(pool, { preparedStatements: true })`, default false so every existing caller sends byte-identical configs; (3) name = `hejbro_` + 32 hex of SHA-256 over the text, only built kinds (select/insert/update/delete/setOp), the `sql` kind never (multi-command texts cannot be prepared; hejbro parses no SQL); (4) the Supabase transaction-pooler endpoint refuses a preparing base at construction with `prepared-statements-without-session` + Next:, and declares false; Neon HTTP declares false; Nile inherits its base; (5) no eviction, plan-cache behaviour documented not mitigated; conformance kit not extended. Reason for opt-in: a transaction-mode pooler binds a name on a backend that never parsed it (server error on the second transaction), and Postgres may switch a prepared statement to a generic plan — both are choices a caller should make knowingly (explicit over implicit). Ratification: owner on return.

<a id="r2"></a>
## R2 — Review close-out: the never-share sentence is made honest (128-bit hash), PgDriverOptions export ratified, the shared name helper and two follow-ups go to #815

_lead · interpretation · basis 303/R1; ps-reviewer round 1 (B 0 / N 5, 18 scenarios, 62 constructed inputs); ps-planner's report · 2026-09-05T06:22Z · ratified: pending_

(1) Delta sentence: "two different texts never share a name" -> "two different texts do not share a name -- the name is a 128-bit digest of the text, so a collision is not a practical possibility"; applied in the closing commit. (2) `export type { PgDriverOptions }` (and neon's) ratified -- the repository's convention for option types. (3) The duplicated name helper's home is @hejbro/query; a follow-up under #815, not this piece (cross pins hold the regression). (4) Follow-ups under #815: multi-command `sql` text returns undefined from the pg driver (pre-existing); the reviewer's three corpus items go to #714 (examples/brownfield). Ratification: owner on return.

<a id="r3"></a>
## R3 — D106 R1 for add-prepared-statements: B0/N5/OK16 — N2 N4 N5 fixed in the archive, N3 fixed with a patch, N1 = #892

_lead · extension · basis D106; 412/D24, D25; evaluation.md (fable, context-free; PgBouncer transaction mode and a wsproxy Neon path exercised) · 2026-09-05T09:19Z · ratified: pending_

N1 (multi-command sql text → undefined / uncoded TypeError) is #892, folded into add-batched-transactions. N2: the delta and query-layer.md now state that a db.fn call compiles as the sql kind and is never named. N3: pg and neon read preparedStatements with === true and freeze the capabilities object (patch changeset, tests). N4: prepared-statements-without-session added to query-layer.md's error table. N5: the delta states that no query-layer operation requires prepared-statements, so the fails-closed scenario has no input for it by design. Archived as 2026-09-05-add-prepared-statements. Ratification: owner on return.

