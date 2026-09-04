# Decisions — quickstart-now/hejbro#318

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-31T00:00Z_

The delegation itself is the owner input. The change executes the
re-scoping the 2026-08-30 layer finding recorded on #318: the
claims-provider callback the issue originally sketched on the Supabase
driver factory violates `rls-execution-context` (fail-closed,
path-independent validation whose whitelist unions four sources — three
of which do not exist on a driver value), so the feature moved to the
query layer with the preset reduced to an adapter. Four provisional
leanings from that ruling (explicit `as()` wins; no-claims applies the
anon context; once per execution, uncached; missing capability fails on
first execution) were left "to be settled in that change's own design
round".

