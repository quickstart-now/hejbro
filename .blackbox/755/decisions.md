# Decisions — quickstart-now/hejbro#755

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — The EXPLAIN-unavailable declaration lives on the Preset

_lead · interpretation · basis provider-preset rule · 2026-09-03T17:00Z · ratified: pending_

Ledger R63.

`check` always uses vanilla `@hejbro/pg` (#458 open), so a declaration on the Nile driver decorator would never reach it; the declaration goes on the Preset: `Preset.explainUnavailable?: true`, in the same "data declaration, silence means supported" form as the driver's `roleLessPlatform` / `contextRequired`. The driver capability set ("exactly two", the owner's decision 1) is unchanged. No core special case (provider-preset rule).

<a id="r2"></a>
## R2 — Text comparison only under a declaring preset; a mismatch is check-not-compared, never differs

_lead · extension · 2026-09-03T17:00Z · ratified: pending_

Ledger R64.

Text comparison runs only when the declared preset asks for it. After normalisation (whitespace, one pair of outer parentheses, meaningless identifier quotes, table qualifiers, casts the server attached to literals) equal texts match; different texts yield `check-not-compared` with both texts and a Next ("restate the declaration in the catalog's spelling"). A text mismatch is not evidence of a semantic difference, so it is never `differs` — the no-false-difference rule is compatible with the spec's "a false pass is worse". The coverage boundary line states "this run compared by text". The `in (...)` → `= ANY(ARRAY[...])` rewrite cannot be matched by this fallback and is reported honestly as not-compared.

<a id="r3"></a>
## R3 — Normalisation step six: lower-case folding outside quotes

_lead · extension · basis R64 · 2026-09-04T00:10Z · ratified: pending_

Ledger R80.

The catalog rewrites keywords in upper case, so every `is not null` check came back not-compared under the text fallback. Normalisation gains a sixth step, lower-case folding outside quotes (meaning-preserving); delta and design.md updated; the `between` rewrite is a documentation example; users' inability to reach generated-column interpolation becomes a follow-up issue.

<a id="r4"></a>
## R4 — The over-claim on index predicates and generated columns is narrowed to check constraints

_lead · interpretation · 2026-09-04T00:20Z · ratified: pending_

Ledger R82.

nl group 2's review passed. A pre-existing over-claim (comparison of index predicates and generated-column expressions through the server's rendering) is handled by narrowing the MODIFIED requirement's first sentence to check constraints and stating the reality in one sentence; the list of compared surfaces lies outside the delta and becomes a follow-up issue (#778). The `between` spelling in the documentation is fixed.

<a id="r5"></a>
## R5 — D106 nl round 1: normalisation inside string literals blocks; the correction round is the next session's

_lead · interpretation · basis D106 · 2026-09-04T00:50Z · ratified: pending_

Ledger R87.

D106 nl R1 = B1 / NB5 / OK13. B1: normalisation steps 3 and 4 (table qualifier removal, identifier unquoting) applied inside string literals, so a real drift (`'"json"'` versus `'json'`) was judged a match — corrected through `transformOutsideSpans`. N1: on a conbin lookup error the text mode still pointed at EXPLAIN in its Next (a SHALL NOT violation with no scenario) — corrected. N4: the reserved word `"order"` was unquoted too (wording drift) — corrected. N5: skills' nile-preset.md linked design.md and said "silently, exactly as …" — corrected. N2 = #781 confirmed (comment). N3 (`NULL::text` casts make a notNullElements check permanently not-compared in text mode) is a follow-up issue for the owner (#782). Per the owner's instruction (only rc and nl to finish before the planned downgrade) the correction team runs in the next session: worktree `fix-nile-d106-r1` (base 333dae88, evaluation.md 4f7b4335); the old nl worktree is removed.

