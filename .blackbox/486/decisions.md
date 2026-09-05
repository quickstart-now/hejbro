# Decisions — quickstart-now/hejbro#486

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — A fourth capability, batched-transactions, with a batch member; a context runs as one batch where interactive transactions are absent

_lead · extension · basis 412/D24, D25; D95 (a truthful capability set names what a driver can do); the #300/#486 measurement (Neon HTTP sql.transaction batch applies set local role + set_config atomically, no leakage); the HTTP driver's existing throwing transaction() precedent · 2026-09-05T08:26Z · ratified: pending_

Design (design.md Q1-Q5): a named capability rather than a buffered fake of transaction(callback); the driver's declaration alone picks the path (interactive wins, batched serves, neither → one error naming both keys); batch(statements) returns one row list per member, atomic, required on Driver with a throwing implementation on false; as(context).transaction(cb) stays interactive-only; the tier check gains a batched leg. driver-contract MODIFIED ×3 + ADDED; rls-execution-context REMOVED ×2 + ADDED ×2. Sequenced after add-prepared-statements archives (shared "exactly N keys" sentence — re-check the delta at merge-in). Ratification: owner on return.

