# Decisions — quickstart-now/hejbro#740

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D4: columns as an ordered list, reader accepts both shapes; D5: synthesize.ts and contract-types.ts inside this piece by exception

_lead · interpretation · basis D1 · 2026-09-04T16:21Z · ratified: pending_

D4 — option (A): the vendored contract's `columns` becomes a list `[{key, sqlName, typeNode, mode, notNullElements}]` in the snapshot's physical order (the same shape as `functions[].args`); the reader accepts both the list and the old object (the pre-functions-contract precedent). Option (B) (keep the object, add `columnOrder`) states one fact in two places. D5 — the runtime reader `packages/query/src/client/synthesize.ts` and `contract-types.ts` (plus their two tests) are inside this piece by exception: the JavaScript engine enumerates integer-like keys first whatever the writer does, so #740 cannot be fixed on the writer alone. The qy team does not touch those files (its files are `name-keyed-db.ts` and the transaction path); the lead orders the merges — qy is in review and lands first, so lands on top and rebases.

<a id="r2"></a>
## R2 — D106 round 1 B1: the owning-client clause was false rationale; delta reworded, SHALLs hold; archived

_lead · interpretation · basis R1, R2, 412/D13 · 2026-09-04T22:34Z · ratified: pending_

D106 round 1 (context-free, opus, dev 31e951fb, 13 projects / 28 declaration variants / 2 hand-written contract shapes / 9 snapshot hand edits / real tsc / 9 SQL programs on PostgreSQL 17.11): BLOCKING 1 / NON-BLOCKING 3 / OK 18. B1: the schema-vendoring requirement claimed the owning repository's own client sends the physical order; measured, `db({posts}, driver)` is built from declarations and sends the declaration's literal order. The normative SHALLs (list in physical order, name-keyed client built from it, `Row` interface order) hold as shipped, and column lists agree by name, never by position — so the false clause was rationale, and the repair under the delegation (412 D12/D13) is the sentence: the delta now says the consumer's list follows the catalog and the owning client sends the declaration's literal order. Not a product change; recorded here so the archived spec never carries the false claim. Archived.

