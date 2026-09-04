# Decisions — quickstart-now/hejbro#298

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

1. Asked to pick the base structure, the owner first asked what the
   UX/DX actually looks like from the user's seat — answered with a
   full walkthrough (code, hover types, compiled SQL, day-2 renames)
   before any option was re-offered.
2. Asked whether the spec for the two-layer path already existed —
   answered honestly: no; the recon existed, the spec would be the
   product of this very brainstorm, at roughly twice add-query-layer's
   piece scale if both layers ship.
3. "What is `with`? How does it differ from join syntax?" — the
   question that killed the name: a chain method named `with` would
   collide with SQL `WITH` (#299's CTEs), which the explanation
   surfaced as a real dishonesty, not a taste issue. The collection-
   vs-flat-rows contrast (three joined rows vs one row with an array
   field) was drawn out with literal result rows.
4. "What syntax does Drizzle use?" and then a pasted Drizzle schema —
   "isn't THIS Drizzle syntax?" — which exposed the distinction the
   lead had underexplained: Drizzle's `.references()` builds the DDL
   but its query layer reads only the separate `relations()`
   declaration. That observation opened the column-level
   `.references()` decision, where hejbro diverges: one declaration
   feeds both DDL and types.
5. Mid-authoring, the owner challenged the ledger twice ("it was 5/7,
   why proceed?", then "I think only 5 were decided") — resolved by
   showing the seven recorded selections and separating the original
   five queue items from the two mid-flow insertions (the
   `.references()` decision and the method rename), then formally
   re-offering the inserted two; the owner confirmed both valid.

