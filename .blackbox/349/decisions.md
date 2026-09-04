# Decisions — quickstart-now/hejbro#349

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

1. The owner directed: process #349 first (before the feature track).
2. The assistant presented the fix-direction background (SQL semantics:
   Postgres arrays are element-nullable always, no DDL forbids it;
   Drizzle comparison; both options' full UX; spec/process cost of
   each) and asked (A) element types gain `| null` vs (B) keep non-null
   and fail fast. The owner chose (A), then interrupted to add: going
   (A) must come WITH usability improvements, not alone.
3. The owner supplied Drizzle context: Drizzle behaves like the lie
   version out of DX obsession and Prisma-legacy assumptions; its own
   issue #2656 acknowledges the incorrect inference but a fix is
   frozen by breaking-change fear, punting users to the unconstrained
   `$type` override.
4. The owner rejected "TS 5.5 filter narrowing is the consumption
   answer" as poor ergonomics and sketched dedicated surfaces instead:
   a chained declaration method (`.array().$notNullElements()` sketch)
   plus a runtime narrowing utility (`hasNoNulls(rows[0].tags)`),
   stating the bar: keep (A)'s honesty AND ship ergonomics that don't
   envy Drizzle. (Logged in dd-thinking's rejection log; the rule:
   "the standard library already handles it" is a floor, never the
   answer.)
5. Settled plan: #349 lands now as the type correction; the ergonomics
   package (CHECK-backed `.notNullElements()` — the assistant
   recommended dropping the `$` prefix since `$`-prefixed methods are
   the type-only convention and this one emits SQL — plus an
   honest runtime-checked narrowing utility) becomes its own Feature
   issue + OpenSpec change, accepted as +1 on the 0.2.0 gate.

