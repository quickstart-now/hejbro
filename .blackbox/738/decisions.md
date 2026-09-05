# Decisions — quickstart-now/hejbro#738

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — A core-built SetOpStage carries both branch stage types; ExecuteResult folds them with SetOpResult

_lead · extension · basis 412/D24, D25; the chain's own resolve-then-union rule (db/chain.ts); the query-type-inference requirement's stated carve-out; openspec MODIFIED cannot drop scenarios (REMOVED+ADDED) · 2026-09-05T08:14Z · ratified: pending_

Design (design.md Q1-Q4): SetOpStage<TProjection, TLeftStage = unknown, TRightStage = unknown>; combinators fill the stages, orderBy/limit forward them; @hejbro/query resolves each branch's row (own left-joined tracking, nested stages recursively) and unions with SetOpResult; unknown branches keep today's left-projection fallback; with.ts/chain.ts one-argument uses stay valid by default. Recursive CTE anchor/term typing out of scope. query-type-inference requirement REMOVED + ADDED. Ratification: owner on return.

