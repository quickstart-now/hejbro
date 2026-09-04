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

<a id="r6"></a>
## R6 — The D106 round-1 correction of fix-nile-findings is lead-run, without a piece team

_lead · extension · basis hejbro#785/D3 · 2026-09-04T06:43Z · ratified: pending_

Four mechanical tasks (two normalization scopes, one Next wording, one document line), each with its red test written from the round-1 finding, do not justify summoning a planner, an implementer and a reviewer; the lead ran them with TDD in `fix-nile-d106-r1` and lets the D106 round-2 evaluator be the independent check. This extends the team-up rule "one group = one team summon" for correction rounds of this size; the owner said "the way of working is the same delegation as before" and ratifies or rejects this at the release gate.

<a id="r2-ratification"></a>
## R2 accepted

_evaluator · 2026-09-04T07:22Z_

Rules are silent on a text fallback where EXPLAIN is unavailable; gating it on a declaring preset and reporting a mismatch as check-not-compared rather than differs refuses to turn a spelling difference into a semantic claim, which is the measured-claims standard and consistent with the spec's 'a false pass is worse'. The honest report of the in (...) rewrite is the same principle.

<a id="r3-ratification"></a>
## R3 accepted

_evaluator · 2026-09-04T07:22Z_

A mechanical extension of the normalisation the same ruling family established, driven by a measured symptom (every is not null check came back not-compared) rather than a guess. It touches design.md prose, not the owner-gated decision log, so no revisit is involved; the spec must state the folding boundary precisely, since folding must leave quoted identifiers and string literals alone.

<a id="r6-ratification"></a>
## R6 accepted

_evaluator · 2026-09-04T07:22Z_

team-up's 'one group, one team' rule is written for a tasks.md group, and a post-merge D106 correction round is not one, so the rules are silent; running four mechanical, test-first tasks in the lead session while leaving the independent check to the D106 round-2 evaluator preserves the gate and removes a summon the work does not justify, which the owner's cost mandate asks for.

