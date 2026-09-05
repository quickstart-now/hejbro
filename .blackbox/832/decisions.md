# Decisions — quickstart-now/hejbro#832

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-function-locals: the reserved class becomes R, T and C; body locals take the argument key's three checks; the ledger is seeded with argument names

_lead · extension · basis 412/D24, 412/D25; the five issues' own measurements (#832 N1/N2 on PG 17.11; #816/#817/#821 from the co team; #818 wording) · 2026-09-05T05:26Z · ratified: pending_

One piece for #816 #817 #818 #821 #832 (design.md Q1-Q4): category C measured whole on postgres:17 in three positions, exit/elsif stated harmless; loop and row names go through invalid-sql-name first, so case folding in the duplicate check is unnecessary (a hejbro SQL name is lower-case) and #821's shape is refused by the first rule; the ledger is seeded with argument SQL names (duplicate-local-name names the argument); duplicate-column names both keys. Two deltas: plpgsql-function-bodies (MODIFIED + ADDED), table-declaration (ADDED). Ratification: owner on return.

<a id="r2"></a>
## R2 — Two name spaces for body locals; the reserved check applies to rendered names only

_lead · interpretation · basis 412/D24, D25; 832/R1; fl (a) tripwire: tasks 1.2/1.3 rows and the kept scenario 'A row name is judged by the locals it declares' · 2026-09-05T09:15Z · ratified: pending_

Variable space = argument SQL names, loop record names, row-derived scalars; block space = loop names and row names (a loop name sits in both). duplicate-local-name stays the one code, its text naming the colliding constructs. Row names take the SQL-name and duplicate checks only (they never render); loop names and row-derived scalars take all three. design.md Q2 restated by the planner. Ratification: owner on return.

<a id="r3"></a>
## R3 — The reserved class states three sources; the set never loosens in this change

_lead · extension · basis 412/D24, D25; 832/R1; fl measurement: catcode C = 63 (61 new), 16 names in the set outside R/T/C and the declared-variable list, new/old missing from that list · 2026-09-05T09:15Z · ratified: pending_

(A): the requirement's class = R+T+C keywords, plpgsql's own declared variables (found, sqlstate, sqlerrm, tg_*, and new/old in trigger bodies), and the measured list of plpgsql statement-opening words that fail in a rendered position; exit/elsif stay out by measurement. Names measured harmless are not removed here (loosening is another change) and are recorded in W#. proposal's 63/61 sentence corrected by the planner. Ratification: owner on return.

