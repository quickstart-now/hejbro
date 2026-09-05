# D106 evaluation — harden-function-locals (round 1)

Reviewer: context-free session, model fable. Read only the delta
(`openspec show harden-function-locals --diff`), the public DSL surface,
`skills/hejbro/references/function-builder-pitfalls.md`, and the built
CLI's observable behaviour. No proposal, design, tasks, source or tests.

## Method

Every universal claim in the delta was run as an input table through the
built CLI (`packages/cli/dist/cli.js generate`, spawned as a child process
from a throw-away project whose `node_modules/hejbro` symlinks
`packages/cli`), and every accepted rendering was applied to a fresh
`postgres:17` (17.11) container; refused names were additionally
substituted by hand into an accepted rendering and applied, to measure
the server side of each claim in both directions.

Axes:

- **Name class** — every category-C (63), R (78) and T (23) keyword pulled
  from `pg_get_keywords()` on the container; the 17 plpgsql-declared
  variables (`found`, `sqlstate`, `sqlerrm`, `new`, `old`, twelve
  `tg_*`); the eleven "failing" statement words, the five "kept"
  words and the nineteen "harmless" words the delta names one by one;
  13 letter-case variants (`FOUND`, `Found`, `TG_OP`, `Row`, `ROW`,
  `Int`, `NEW`, `Old`, `Query`, `NEXT`, `Select`, `LEFT`, `Begin`); 25
  non-SQL-name spellings (`my-loop`, `Item`, `2nd`, `a b`, `""`, `ñame`,
  `Row_a`, `_x`, `1x`, `x$`, `a.b`, `x"y`, `sélect`, `myLoop`, … plus the
  valid neighbours `x__y`, `x1`, `x_1`, `row_`, `user_id_`, `my_loop`);
  14 "merely contains an owned name" names (`found_at`, `row_found`,
  `tg`, `tg_ops`, `sqlstate_code`, `state`, `int_x`, `x_int`, `new_row`,
  `query_x`, `next_x`, `json_arrays`, `jsonarray`, `values_`).
- **Position** — argument key (scalar return `return <arg>`; plus
  `return coalesce(<arg>, 'd')` and a `returns setof` body for the eleven
  statement words), `ctx.forEach` loop name (plain function and, for
  `new`/`old`/`found`/`tg_op`, a trigger body), `ctx.row` read name, and
  `ctx.row` derived local (`<row>_<col>` for all eleven underscore-bearing
  C keywords, `tg_op`, `tg_label`, `tg_ops`, `x_int`, `merge_action_x`,
  `json_array_agg`).
- **Collisions** — 35 hand-written rows: argument vs loop, argument vs
  row-derived local (incl. `rowOrNull`, camelCase argument keys), row
  name equal to an argument name with free locals, loop vs row, two
  loops, two rows, `row`/`rowOrNull` pair, two rows whose derived locals
  coincide (`a_b`+`c` vs `a`+`b_c`), nested loops of one name, the
  unnamed-row counter vs an explicit `row_1` / an argument `row_1_id`,
  case-folded pairs (`row_a`/`Row_a`, `r`/`R`), `duplicate-argument`, and
  six `duplicate-column` maps (both orders of `userId`/`user_id`, three
  orders of the four-key map, a three-key map).

Rows executed: **890 `hejbro generate` runs** (847 generated table rows +
35 collision rows + 8 template smoke rows); **326 accepted renderings
applied to the server, 326 succeeded**; **674 hand-substituted
renderings applied to the server** (refused names in the accepted shape,
plus the harmless words in every position) to check the delta's server
claims. Expected outcome per row was derived from the delta text only;
830/847 table rows matched it, and the 17 that did not are all argument
keys with a capital letter, where my model (not the delta) assumed
`Row` snake_cases to `row` — hejbro derives `_row`, so the refusal is
`invalid-sql-name` naming `_row`; the delta's argument scenarios are
phrased "whose derived SQL name is …" and make no claim about those
keys, so they are not a contradiction (see NB2 for the skill's wording).

Server measurements (independent of hejbro): as an argument in the
shape hejbro renders, all 63 C keywords fail at creation — 60 with
42601, `inout`/`out` with 42804, `setof` with 42P13; as a loop record and
as a row-declared local all 63 are created. `next`/`query` as an
argument: 42804 ("cannot use RETURN NEXT/QUERY in a non-SETOF function");
inside `coalesce(…)` and in a `returns setof` body both are created.
`begin`, `by`, `declare`, `execute`, `foreach`, `if`, `loop`, `strict`,
`while`: created as an argument, 42601 as a loop record and as a
row-declared local. `exception`, `get`, `perform`, `raise`, `return` and
all nineteen harmless words: created in every position. All 17 plpgsql
variables: created in every position; `found` as an argument returns
`false` (plpgsql's `FOUND`) when called with `'v'`. Every one of these
matches the delta's stated measurements.

## Blocking findings

None.

## Non-blocking findings

1. **`duplicate-local-name` between two row-derived locals names the
   locals, not the constructs.** Repro: `ctx.row(select({ c: items.label },
   items), "a_b")` beside `ctx.row(select({ b_c: items.label }, items),
   "a")`. Observed: `app.f: the row-declared local named "a_b_c" collides
   with the row-declared local named "a_b_c" — one name, two constructs.
   Next: rename one of them.` The requirement says "the message names
   which two constructs collided"; here the two constructs are the row
   reads `a_b` and `a`, and neither appears, so the reader must
   reverse-derive which reads produced `a_b_c`. The same shape appears
   for a loop vs a derived local (`the loop named "x_id" collides with the
   row-declared local named "x_id"` — the row read `x` is not named). The
   delta's own scenarios (argument vs local, two loops, loop vs row) all
   pass; this is the neighbour the sentence covers but no scenario pins.

2. **Skill reference (`function-builder-pitfalls.md`) states the third
   source as "fourteen words" and implies `FOUND` as an *argument key*
   answers `reserved-local-name`.** The delta's third source is sixteen
   words (eleven failing + five kept), and the skill's own parenthetical
   ("opens one of its own statements with") does not describe `by` or
   `strict`, which are refused. Separately, the paragraph sits under
   "Argument names are hejbro SQL names" and says "`FOUND` fails as
   `reserved-local-name`"; observed for an argument key `FOUND` is
   `invalid-sql-name` naming the derived `_f_o_u_n_d` (and `Row` →
   `_row`, `Found` → `_found`), because the key is snake_cased before any
   check. True for a loop name, misleading for an argument key. The skill
   is a user contract, so the sentence should say which position it
   describes.

3. **Loop and row names are taken literally while argument keys are
   snake_cased first — the same author spelling lands differently.**
   `args: { myArg }` is accepted (derives `my_arg`), while
   `ctx.forEach(q, fn, "myLoop")` and `ctx.row(q, "myRow")` are refused
   with `invalid-sql-name`. The delta says this (the rule is on the
   *derived* name, and a loop name has no derivation), and the refusal is
   the safe side, but nothing on the surface tells the author that
   camelCase is fine in one place and not the other. A follow-up could
   either snake_case loop/row names like keys, or have the
   `invalid-sql-name` message for loops/rows say "use snake_case (loop
   names are not converted)".

4. **The `invalid-sql-name` message for a loop or row read carries the
   column/table rationale.** Observed: `loop in app.f name "R" is not a
   valid hejbro SQL identifier — names must match ^[a-z][a-z0-9_]*$
   (lower-case snake_case, no dots or symbols) so they can be referenced
   from --rename/--confirm-drop flags.` A loop name is never referenced
   from a `--rename` flag; the shared message's "so they can be …" clause
   is wrong for this position. Code and name are right; only the reason
   text is borrowed.

5. **Unnamed-row counter vs explicit names is order-dependent.**
   `ctx.row(q)` then `ctx.row(q, "row_1")` is refused
   (`duplicate-local-name`: `row_1` collides with `row_1`), but
   `ctx.row(q, "row_1")` then `ctx.row(q)` is accepted, the second read
   being numbered `row_2` by ordinal. Consistent with "one name, two
   constructs" and with D21's counter, and the server accepts the
   rendering, but an author who names one read `row_1` gets a different
   answer depending on where the unnamed read sits. Outside the delta;
   noting it as a neighbour.

## Scenarios verified

| Scenario (delta) | Rows | Result |
|---|---|---|
| A loop or row name that is not a hejbro SQL name is refused (`my-loop`, `Item`, `2nd`, `a b`, `""`, non-ASCII → `invalid-sql-name`; loop `Row` → `reserved-local-name`) | 25 spellings × loop/row + 13 case variants × loop/row + `rowOrNull` ×2 | PASS — every non-SQL spelling `invalid-sql-name` naming `app.f` and the exact name (incl. `""`); every reserved-class case variant `reserved-local-name` as a loop, `invalid-sql-name` as a row name |
| Two spellings that fold to one name never both pass (`row_a`/`Row_a`) | 2 (`row_a`/`Row_a`, loops `r`/`R`) | PASS — `invalid-sql-name` on `Row_a` / `R`, no SQL written |
| A local by an argument's name is refused (`args: {x}` + loop `x`; `args: {x_id}` + row `x` over `id`) | 6 | PASS — `duplicate-local-name` naming `the argument named "x"` / `"x_id"` (also for `rowOrNull`, and for `xId`/`userId` keys via their derived names) |
| A row read may carry an argument's name (`args: {x}` + row `x` over `id`) | 2 | PASS — accepted, created on the server; row `x` over a column `x` (`x_x`) accepted too |
| Two locals of one name are refused (two loops `r`; loop `r` + row `r`) | 6 | PASS — `duplicate-local-name` naming `app.f` and `r`, both orders, `row`+`rowOrNull`, nested loops |
| A variable plpgsql declares itself is refused as a loop name (`found`, `FOUND`, `Found`, `tg_op`, `TG_OP`, `new`, `old`) | 17 variables × arg/loop + 4 trigger-body loops + case variants | PASS — `reserved-local-name` in every case; server measurement confirms `found` as an argument returns plpgsql's `FOUND` |
| A column-name keyword is refused in every rendered position (all 63 C as argument and loop; the 11 derivable ones as a row local; `exit`/`elsif` stay accepted) | 63×2 + 11 + 19×3 | PASS — 63/63 `reserved-local-name` as argument and loop, 11/11 as derived local (`json_array` … `merge_action`), all 63 accepted as a row *name* and created on the server; `exit`, `elsif` and the other 17 harmless words accepted and created in all three positions. Server: 60×42601, `inout`/`out` 42804, `setof` 42P13 as argument; all 63 created as loop record / row local — exactly as stated |
| A word plpgsql reads as statement syntax is refused where it breaks (`next`/`query` as argument and loop, also in `coalesce` and `returns setof`; row *named* `next` accepted; the nineteen harmless words accepted) | 11×5 + 5×3 + 19×3 | PASS — all eleven `reserved-local-name` as argument (plain, `coalesce`, `setof`) and loop; accepted as a row name; five kept words refused as argument and loop; nineteen harmless words accepted everywhere and created on the server. Server: `next`/`query` 42804 at `return <name>`, created inside `coalesce` and under `returns setof` |
| A name that merely contains an owned name is accepted (`found_at`, `row_found`, `tg`, `tg_ops`, `sqlstate_code`, `state`; row `tg` deriving no owned name) | 14×3 + 6 derived | PASS — all accepted and created; row `tg` over `op` refused (`tg_op`), over `label`/`ops` accepted |
| R and T keywords (unchanged class, regression) | 101×3 | PASS — `reserved-local-name` as argument and loop; accepted as a row name |
| Two keys deriving to one column name are refused naming both keys (`userId`/`user_id` either order; `aB`,`xY`,`x_y`,`a_b` → `xY` and `x_y`) | 6 | PASS — `table "t2" declares columns "userId" and "user_id" that both derive to the SQL name "user_id"`; four-key map names `xY` and `x_y`; other orders report the first repeating key with its earlier partner, as the requirement states |

## Verdict

**ARCHIVE.** Every delta scenario holds on the shipped CLI across the full
keyword categories and the named word lists, in every position the delta
claims, and every server-side measurement the delta states was
reproduced on PostgreSQL 17.11. The five non-blocking items are
message-wording and skill-text neighbours for follow-up issues.
