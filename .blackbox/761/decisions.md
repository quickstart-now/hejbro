# Decisions — quickstart-now/hejbro#761

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — Q2: leading word = first non-space non-semicolon run; second word only across whitespace; comments stated as a limit

_lead · interpretation · basis D1 · 2026-09-04T15:17Z · ratified: pending_

Q2 (#761): (a) the leading word is the first run of characters that are neither whitespace nor `;` after trim and lower-casing (leading `;`/whitespace skipped); a second word counts only when whitespace alone separates it from the first — a `;` in between ends the leading statement. Measured consequences accepted: `commit;`, `commit; ;`, `COMMIT;;`, `;commit`, `rollback; to savepoint x` → end; `begin; set local x`, `  BEGIN ;` → open; `start; transaction` → ordinary (the server refuses a bare START too). Option (ii) (split on `[\s;]+`) is rejected: it misreads `rollback; to savepoint x` and `start; transaction`. (b) a comment before the control word is stated as a limit and pinned by a scenario — the kit reads the leading word, not SQL lexical structure; a lexer (nested block comments) is the same class as the chain-opening forms already tracked from the previous round (#762, #763), which are not half-closed here. (c) the regression evidence is the four kit consumers (pg, supabase session/pooler, neon http) green as 1.2's definition of done; `@hejbro/pg` is session-state true, so its tier does not exercise the normalizer.

