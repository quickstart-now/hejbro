# Decisions — quickstart-now/hejbro#748

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Batch co = #748 #751 #774 as one change harden-core-derivations, parallel to li and ip

_lead · interpretation · basis D1 · 2026-09-04T12:53Z · ratified: pending_

Third concurrent batch under #412 D11 and #412/R1–R3: the core bugs #748 ("found" missing from the PL/pgSQL reserved-name list, shadowing FOUND silently), #751 (two function argument keys that derive to one SQL name are not refused) and #774 (diff-engine byIdentity reassembly drops a second same-identity, same-direction change from one kind) — three bugs, one change `harden-core-derivations`, one PR, tracking issues = the bug issues. Files: `packages/core/src/plpgsql/*`, `packages/core/src/dsl/*` (function/argument derivation), `packages/core/src/engine/diff-engine.ts` and their tests — no overlap with the li or ip batches (both `packages/cli`). Core purity holds (no I/O, no runtime deps). Team co = planner (fable), implementer (sonnet), reviewer (opus); the reviewer runs in spec-bound mode with D110 input tables (the inputs are hejbro's own declarations, not foreign input). The lead approves the proposal and settles `[design]` decisions under the owner's delegation (#750 D3/D7).

<a id="r2"></a>
## R2 — harden-core-derivations approved; Q1 list = plpgsql variables + fully reserved keywords; Q3 lower-cased compare; Q4 wording

_lead · interpretation · basis D1, R1 · 2026-09-04T13:05Z · ratified: pending_

Proposal and delta of `harden-core-derivations` approved under the owner's delegation (#750 D3/D7), pending the planner's one-line `validate --strict` confirmation.

Q1 — the reserved-name list: option (b). The fifteen variables plpgsql declares itself (`found`; `sqlstate`, `sqlerrm`; the `tg_*` trigger variables) plus the fully reserved keywords missing today (`analyse`, `analyze`, `current_catalog`, `except`, `lateral`, `system_user`), whose category in Postgres's own keyword list is the evidence. The type_func_name class (option c) is not added without a measurement: adding it blind risks refusing what Postgres accepts, and the current list's own history (D36) is "reject what was measured to break".
Q3 — case: option (a). `assertValidLocalName` compares lower-cased: Postgres folds an unquoted name, so `FOUND` and `found` are one name; the acceptance says "spelling regardless". Applying `assertSqlName` to loop and row names (option b) is a separate contract and goes to the follow-up queue.
Q4 — message: option (b). "collides with a name plpgsql reserves — a keyword, or a variable plpgsql declares itself such as found or tg_op — which cannot be declared unquoted in a function body. Next: rename it." The code `reserved-local-name` is unchanged (diagnostics spec); the wording now states what was observed instead of calling `found` a reserved word.

<a id="r3"></a>
## R3 — Q2: tg_* refused uniformly in every function

_lead · extension · basis D1, R1 · 2026-09-04T13:05Z · ratified: pending_

Q2 — the `tg_*` variables are refused in every function, trigger or not (option a). One list, one check, one message; the cost is that a plain function cannot name an argument `tg_op`, which no reader would want anyway. Threading a trigger context through `assertValidLocalName` (option b) adds a branch to buy a name nobody should use. This is stricter than Postgres for a non-trigger function, hence an extension, not an interpretation.

<a id="r4"></a>
## R4 — Review: category-T keywords are added now that they are measured; the sentence stands

_lead · interpretation · basis D1, R2 · 2026-09-04T13:51Z · ratified: pending_

Review finding (co-reviewer, constructor mode, Postgres 17.11): the added requirement defines the refused class by a property — a name that cannot stand unquoted in a body at all — and every one of the 23 type_func_name (category T) keywords has that property: `left, is, join, full, like, binary, inner, similar, …` each fail at `create function` when rendered as a bare local. R2's Q1 withheld them only "without a measurement"; the measurement now exists, and its basis ("reject what was measured to break") points one way. Ruling: add the 23 category-T keywords to the reserved list, keep the requirement sentence as written, extend the input table with the measured rows (source: `pg_get_keywords()` category T on PG 17). Narrowing the sentence instead would leave a measured, noisy failure in place to protect a scope line. The three non-blocking sentence items are repaired in the same rework: scenario 5 states the projection condition under which a row named `tg` succeeds; "the first pair" is defined as the first key, in declaration order, whose derived name repeats an earlier key's — reported with that earlier key; the case-sensitive `duplicate-local-name` sibling is pre-existing and outside the delta — filed as a follow-up. README CRAP restamp is the lead's, before the PR.

<a id="r5"></a>
## R5 — Review, final: all 23 type_func_name keywords refused, class defined by source; current_schema is the silent-shadow case

_lead · interpretation · basis D1, R2, R4 · 2026-09-04T14:08Z · ratified: pending_

Supersedes R4's count and the interim "22" instruction. The co reviewer measured the type_func_name class fully on Postgres 17.11: 22 of the 23 fail as bare locals in expression reads (hejbro emits no assignment, so the assignment axis is moot), and `current_schema` — the one that reads fine — is the worst of them: a local by that name resolves to the built-in function in every expression position and to the local only as a `select … into` target or in `return`, so a function argument named `current_schema` is silently replaced by the schema name inside a `where` (measured: the caller passes 'draft' and gets the 'public' row). All 23 are refused. The requirement defines the class by source, not consequence: a name Postgres reserves (`pg_get_keywords()` categories R and T) or a variable plpgsql declares itself — such a local either fails somewhere in the body or silently changes what the name means. The `reserved-local-name` message states the same and no longer claims "cannot be declared unquoted". Basis: the decision rule (#412 D10/D11 on dev — decide inside hejbro's purpose: a function must mean on the server what it means in the declaration) and the measurement.

<a id="r6"></a>
## R6 — D106 round 1 disposition: N3/N4 repaired at archive, N1/N2 to #832, archived

_lead · interpretation · basis D1, R5 · 2026-09-04T14:42Z · ratified: pending_

D106 round 1 (context-free, opus, dev 419c8faa): BLOCKING 0 / NON-BLOCKING 4 / OK 13. Disposition under the delegation: N3 (the shadowing direction was stated backwards for arguments — measured: an argument named `found` is unreachable behind plpgsql's own variable) and N4 (the precedence scenario never pinned the offender-last order) are repaired in the archive PR — spec, changeset, skill sentence, two test rows. N1/N2 (61 category-C keywords fail as argument names yet are not refused; `between`/`exists` sit outside the stated class) are inside hejbro's purpose and go to #832 as their own piece with their own input table; the archive is not held for a list extension. Archived; the new capability `snapshot-diff` gets its Purpose from the design draft in the same commit.

