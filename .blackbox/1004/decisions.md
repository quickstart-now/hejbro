# Decisions — quickstart-now/hejbro#1004

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — refusal lives in the shared emitter; one code per command, remedies differ

_lead · extension · basis 412/D29, 653/R8 · 2026-09-07T14:10Z · ratified: pending_

The issue's verdict (412/D29) settles the shape: refuse at emission with a coded diagnostic naming both tables and their schemas, no key qualification. Four details it leaves open are settled here.

1. Where. The guard lives in the shared contract emitter (`emitContract`, `packages/cli/src/contract`), so both commands that emit a contract refuse: `vendor` (git origin) and `pull` (database origin). A collision is two carried tables whose SQL names are identical across different schemas; identity is exact (`Users` and `users` are two names). Functions are untouched: they are keyed by export name and already have their own requirement.

2. Codes. One code per command, `vendor-table-name-collision` and `pull-table-name-collision`, because the remedies differ and the vendoring spec's own rule says a situation earns its own code when its remedy is distinct. Prefix follows the operation (naming rule from the apply engine).

3. The way out. The issue's verdict pointed `Next:` at a schema filter. For `vendor` that flag is reserved and refused (spec, "The schema filter is reserved, not silently ignored"), so pointing at it would send the reader to a dead end; `vendor`'s `Next:` says the filter is reserved and that the export itself must carry one table per SQL name, which is the declaring repository's to fix. `pull` has a real filter, so its `Next:` says to drop one of the schemas from `--schema`. Interpretation of D29 against the shipped spec, not a reversal.

4. Spec placement. The enumeration "Each way vendoring can fail is named separately" is scoped to obtaining and checking; emission is shared with `pull`, so the refusal is a new requirement stating that scope explicitly, not a twelfth member (a MODIFIED block cannot rename the "eleven" scenario; REMOVED+ADDED of the enumeration for one word is not worth the churn). "An existing table crosses the boundary" is MODIFIED to point at the refusal instead of calling the pair "the emitter's unresolved collision".

Execution: the lead implements directly in one group (412/R32 precedent for lead-direct items), test-first, with the input table spanning both origins, managed/managed and existing/managed pairs, three schemas on one name, two names colliding at once, case-distinct names, and a unique-name layout. Owner ratification queued (D87: the proposal is approved by the owner; delegation 412/D23).

