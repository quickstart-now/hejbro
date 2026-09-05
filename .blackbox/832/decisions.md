# Decisions — quickstart-now/hejbro#832

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — harden-function-locals: the reserved class becomes R, T and C; body locals take the argument key's three checks; the ledger is seeded with argument names

_lead · extension · basis 412/D24, 412/D25; the five issues' own measurements (#832 N1/N2 on PG 17.11; #816/#817/#821 from the co team; #818 wording) · 2026-09-05T05:26Z · ratified: pending_

One piece for #816 #817 #818 #821 #832 (design.md Q1-Q4): category C measured whole on postgres:17 in three positions, exit/elsif stated harmless; loop and row names go through invalid-sql-name first, so case folding in the duplicate check is unnecessary (a hejbro SQL name is lower-case) and #821's shape is refused by the first rule; the ledger is seeded with argument SQL names (duplicate-local-name names the argument); duplicate-column names both keys. Two deltas: plpgsql-function-bodies (MODIFIED + ADDED), table-declaration (ADDED). Ratification: owner on return.

