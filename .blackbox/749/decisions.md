# Decisions — quickstart-now/hejbro#749

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D6: whole-row only under returns setof (departs from the issue's full-projection line); D7 return-expects-whole-row; D8 try the type narrowing; D9 check order

_lead · extension · basis D1 · 2026-09-04T16:21Z · ratified: pending_

D6 — option (a): under `returns setof <table>` the body's returned query must be whole-row — `select(<the declared table>)` (joins and where allowed) or a mutation on that table with a bare `.returning()`; every projection (partial, full-but-reordered, aliased) and every other table is refused at declaration. This departs from the issue's acceptance line ("a full projection stays accepted") on purpose: Postgres matches `return query` columns by position, count and type and ignores names, so a full projection in another order is silently wrong whenever the types coincide, and a full projection in the right order is the bare form spelled longer — rewriting it to physical order (b) would silently change what the user wrote and drop aliases. hejbro has no `returns table(...)` form, so the rule has one shape. D7 — code `return-expects-whole-row` (the `return-expects-returning` family), wording per design.md. D8 — narrow the `ReturnableQuery` type (mutations back to projection `undefined`, select to `SelectLimited<Table>`) if it compiles cleanly; otherwise the runtime refusal alone here and the type in a follow-up. D9 — the check runs after `return-expects-returning` and before the body is recorded. Basis: D13 on dev — a function hejbro declares must mean on the server what it means in the declaration, and must not fail only when called.

<a id="r2"></a>
## R2 — D106 round 1 N2: unsupported-return-value names the accepted forms (repaired at archive)

_lead · interpretation · basis R1, R2, 412/D13 · 2026-09-04T22:34Z · ratified: pending_

D106 round 1 N2: `unsupported-return-value` still told the user a query needs `.returning()`, the opposite of the setof rule this change added. Repaired at the archive (tasks.md 2.1): the message names the forms `ctx.return()` accepts (a select over the declared table under `returns setof`, a mutation with `.returning()`, `new`/`old` in a trigger), pinned by the core test. The set-operation stage not being a `ReturnableQuery` is pre-existing and stays out of scope. A false remedy is inside hejbro's purpose to fix; the sentence is one line.

