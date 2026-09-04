# Decisions — quickstart-now/hejbro#354

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="d1"></a>
## D1 — s (English rewrites)

_owner · 2026-08-28T00:00Z_

The direction accumulated across the #349 session (see
`2026-08-28-fix-array-null-elements.md` for that trail): honesty stays,
ergonomics must be overwhelming, dedicated surfaces on both sides —
the owner sketched `.array().$notNullElements()` and
`hasNoNulls(rows[0].tags)`. Three surface decisions were then settled
by AskUserQuestion (2026-08-28), each with background first:

1. Method name: `.notNullElements()` — the owner accepted the lead's
   recommendation to drop the `$` prefix, on the grounds that `$` is
   this codebase's type-only convention (`$type`) and this method
   emits real SQL, making it schema-declaration family like
   `.notNull()`.
2. Utility: `assertNoNulls`, throwing form — the boolean-guard reading
   of the owner's `hasNoNulls` sketch was surfaced (the name reads as
   a predicate, but the sketched usage assigns the return), and the
   assert-prefixed throwing form matching the sketched usage was
   chosen. An unchecked assertion was excluded up front as reopening
   the lie channel #349 closed.
3. CHECK name rule: `<column>_no_null_elements`.

