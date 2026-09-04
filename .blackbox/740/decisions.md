# Decisions — quickstart-now/hejbro#740

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D4: columns as an ordered list, reader accepts both shapes; D5: synthesize.ts and contract-types.ts inside this piece by exception

_lead · interpretation · basis D1 · 2026-09-04T16:21Z · ratified: pending_

D4 — option (A): the vendored contract's `columns` becomes a list `[{key, sqlName, typeNode, mode, notNullElements}]` in the snapshot's physical order (the same shape as `functions[].args`); the reader accepts both the list and the old object (the pre-functions-contract precedent). Option (B) (keep the object, add `columnOrder`) states one fact in two places. D5 — the runtime reader `packages/query/src/client/synthesize.ts` and `contract-types.ts` (plus their two tests) are inside this piece by exception: the JavaScript engine enumerates integer-like keys first whatever the writer does, so #740 cannot be fixed on the writer alone. The qy team does not touch those files (its files are `name-keyed-db.ts` and the transaction path); the lead orders the merges — qy is in review and lands first, so lands on top and rebases.

