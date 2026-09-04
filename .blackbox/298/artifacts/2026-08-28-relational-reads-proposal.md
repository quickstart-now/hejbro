Refs:
- openspec/changes/add-relational-reads/proposal.md @ blob 0fa18cd8992c07ed1158d5c15c3eee42916d250b
- openspec/changes/add-relational-reads/design.md @ blob 787eb12ed9931b730841e8ca9e1becf9838df740
- openspec/changes/add-relational-reads/tasks.md @ blob 76043eb393387a775d18589472ab4b411e921c59
- docs/specs/2026-08-19-hejbro-design.md @ blob b32ec21e30b1a72463e4e1ed603693cab2b19d6a

# add-relational-reads proposal — seven rounds, two of them opened by the owner's own questions

Proposal record for the relational query layer (#298, D102), the first
feature of the owner-sequenced queue ("start from #305, then in
order"; #305 landed the same day). Lead-run brainstorm, no team. The
recon that preceded it was one Explore agent whose three load-bearing
claims (FK info fully type-erased at `table()`'s extras annotation;
no select-as-expression node in the IR; one transaction per `db.as`
call) the lead re-verified in-file before opening the first question.

## Owner inputs (English rewrites)

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

## The seven settled decisions

Two-layer structure (explicit base + FK-derived sugar in one change);
`jsonArrayFrom`/`jsonObjectFrom` (the half-verbatim `jsonAgg`/`jsonRow`
rejected); column-level `.references()` (extras keeps self-referencing/
composite/actions; both converge; double declaration loud);
`related()` (never `with` — CTE collision); forward keys = trailing-Id
strip, reverse keys = schema map names (an earlier "silent rename
trap" claim against Id-strip was CORRECTED during the round: a rename
breaks call sites loudly, the key vanishes from the type); cast +
revive (nested types equal top-level types, no silent 2^53 loss);
sugar depth 1 / `true` only (option objects rejected as the Drizzle
findMany re-invention path).

## Process notes

The ledger's denominator grew 5→7 mid-brainstorm as owner questions
opened decisions; the numbering confusion that caused is a real
communication defect — the corrective adopted: announce "+1 to the
queue" explicitly whenever a decision is inserted. The Explore agent's
report initially went out as session text (invisible) and had to be
re-requested via SendMessage — the same lost-channel failure gc2
produced the standing rule for; agents outside piece teams need the
rule in their spawn prompt too, which the lead now includes.
