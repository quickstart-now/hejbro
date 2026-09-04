# Decisions — quickstart-now/hejbro#783

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch li = #783 #796 #797 as one change; lead approves under delegation; reviewer in constructor mode

_lead · interpretation · basis D1 · 2026-09-04T12:18Z · ratified: pending_

First batch of the 0.2.x queue after 0.2.0-pre.1 (#412 D9, D8). By #412/R1 bugs come first; by severity #783 (reset deletes every row of an unrelated table that merely carries the ledger's name — data loss reported as bookkeeping) leads, and #796 (status dies on a foreign object at the ledger's name) and #797 (a cycle longer than two tables gets the outside-dependent advice) share the same code and the same missing concept: the ledger is identified by existence, not identity. Three bugs, one change `harden-ledger-identity`, one PR, tracking issues = the bug issues (#412/R2). Team li = planner (fable, per the owner's 2026-08-22 model policy), implementer (sonnet), reviewer (opus) in constructor mode because the input is the database catalog (#412/R3, D110). Under the owner's delegation (#750 D3/D7) the lead approves the proposal and settles the `[design]` decisions the planner escalates, each as a recorded ruling. Push, PR, merge and the D106 round stay with the lead.

<a id="r2"></a>
## R2 — harden-ledger-identity approved; D1 ledger identity = ordinary table + four typed bootstrap columns, superset tolerated, partitioned table excluded; D5 no cli-commands delta

_lead · interpretation · basis D1, R1 · 2026-09-04T12:33Z · ratified: pending_

Proposal and delta of `harden-ledger-identity` approved under the owner's delegation (#750 D3/D7): `openspec validate --strict` valid, MODIFIED 3 requirements in migration-apply, no scenario dropped or renamed, four scenarios added, no cli-commands or diagnostics delta (D5: the status contract lives in migration-apply — accepted).

D1 — the ledger's identity: option (b). The relation at `"hejbro"."migration_ledger"` is the ledger only when it is an ordinary table (relkind `r`) whose columns include the four the bootstrap creates, each with the bootstrap's type; further columns do not disqualify. A partitioned table with the same four columns is not the ledger: hejbro never creates one, and the requirement's own words are "a table hejbro creates". Basis: the existing requirement text; measured on postgres:17 that `to_regclass` cannot tell any of these apart, so relkind plus columns is the least judgement that can.

<a id="r3"></a>
## R3 — D2: code apply-ledger-occupied; reset refuses before the confirmation check

_lead · extension · basis D1, R1 · 2026-09-04T12:33Z · ratified: pending_

D2 — the shared refusal. Code `apply-ledger-occupied` (the planner's option b): the prefix follows the operation the two commands share (the ledger-touching operation is the apply family, per the recorded prefix-equals-operation rule), and "occupied" states the fact — the ledger's name is held by something else — where "not-hejbro" leaves the reader asking "not hejbro's what?" and "foreign" collides with foreign tables, one of the very kinds the message names. Message as drafted in design.md, with the kind word and the columns found and a `Next:` that tells the user to move or drop that object themselves or point `--url` elsewhere; hejbro never touches it.

Timing in `reset`: option (b), before the confirmation check. The refusal is a precondition of the same class as the empty-declaration refusal — this is not a database hejbro has applied to — so asking the user to type a `<database>:<count>` token for a run that will be refused anyway is a wasted round trip and a misleading one (it names objects that would be dropped). The probe is one catalog read, no transaction, so nothing the confirmation protects is reached. Existing ordering pins that assumed the probe after the confirmation move with it; the confirmation scenario itself is unchanged for a real or absent ledger.

<a id="r4"></a>
## R4 — D4: every ledger-touching command (migrate, status, reset, raise) uses the one judgement, not only status and reset

_lead · extension · basis D1, R1 · 2026-09-04T12:33Z · ratified: pending_

D4 — scope: option (b), all four commands. The defect is one — the ledger identified by existence — and `migrate` is the worst case of it: `create table if not exists` is skipped with a notice when any relation holds the name, and a table carrying the four column names can then receive hejbro's `insert` rows, which is the #783 class (writing into a relation hejbro does not own), not a cosmetic raw failure. #412/R2 sizes a change by bug count; this adds no bug issue, it closes the same defect's other two doors, at the planner's measured cost (about two tasks, fifteen minutes, two scenarios). The delta sentence "status and reset share it" widens to every command that touches the ledger — `migrate`, `status`, `reset`, `raise` — with one probe call per command and the same code. The three tracking issues stay as they are; #783's record carries the migrate/raise note.

<a id="r5"></a>
## R5 — Review disposition: relkind words, unlogged excluded, columns clause by kind, article repaired; #823 filed

_lead · interpretation · basis D1, R2, R3 · 2026-09-04T14:55Z · ratified: pending_

Constructor-mode review, three rounds (51c0d7d5 → 8f44e927 → 219f05e6). Round 1's blocker (relkind letters `c`/`i`/`I` leaking as `relation (c)`, with a comment asserting a false invariant) repaired: every one of Postgres 17's ten relkinds maps to a word, the comment states the fallback's reason only. Round 1's non-blocking items ruled inside the identity judgement this change defines — hejbro's ledger is a table hejbro creates, so an unlogged table is not the ledger (relpersistence read; the word is composed as "unlogged <kind>", e.g. "unlogged partitioned table", the generalization of the ruled "unlogged table"), the columns clause appears only for relation kinds that carry columns (r/p/v/m/f/c; a column-less relation reads "(no columns)"), an inherited child stays an ordinary table; the ledger-write attribution defect filed as #823. Round 2's blocker (the article — "a index") repaired with the article agreeing with the relation word. Round 3 passed with no new finding. Basis: #412 D12/D13 on dev (decide inside hejbro's purpose: a migration record must be hejbro's own, and a refusal must read as words to a person).

