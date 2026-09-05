# Design: harden-function-locals

Settled by the lead under the owner's full delegation for this pass;
recorded as rulings on the change's issues.

## Q1 — What the reserved class is

- (i) Keep R and T, add the category-C names one by one as they are
  found.
- (ii) State the class as R ∪ T ∪ C ∪ plpgsql-declared variables and
  ship the whole of C, measured.
- **Ruling (ii).** A class stated by source is what the requirement
  already promises; category C is the one source the list left out.
  Every C name is measured on `postgres:17` in the three positions a
  body renders a name (argument, loop record, row-declared local) so the
  scenario's universal claim rests on an input table, not on the four
  names the issue quotes. `exit`/`elsif` stay absent and the requirement
  says why (harmless in every rendered position, measured).
- **Ruling, second pass (measured).** Category C has 63 keywords, 61 of
  them new to the list. Two sources are still not enough to reconstruct
  the shipped set: 16 of its names are neither R/T/C nor a variable
  plpgsql declares — 7 that the keyword table does not list at all
  (`exception`, `foreach`, `get`, `loop`, `perform`, `raise`, `while`)
  and 9 that it lists as `U` (`begin`, `by`, `declare`, `execute`, `if`,
  `new`, `old`, `return`, `strict`). The class therefore states three
  sources: the keyword categories, the variables plpgsql declares (`new`
  and `old` among them, in a trigger body — measured there, not in a
  plain function, where they are harmless), and the words plpgsql opens
  its own statements with, **named one by one**: measurement splits them
  into nine that fail as a local (`begin`, `by`, `declare`, `execute`,
  `foreach`, `if`, `loop`, `strict`, `while`) and five that stand
  (`exception`, `get`, `perform`, `raise`, `return`). The five stay
  refused — this change only widens refusal; relaxing one is a change of
  its own, on its own evidence — and naming all fourteen is what makes
  the class reconstruct the set. `exit`/`elsif` are the same family and
  were never refused, so leaving them out relaxes nothing. (Q5 adds
  `next` and `query` to the failing side, taking the list to sixteen.)

## Q2 — One rule for a local's spelling

A name a body renders — an argument's derived SQL name, a loop's record
name, a row read's derived scalar local — takes three checks in one
order: reserved (`reserved-local-name`, folding case), hejbro SQL name
(`invalid-sql-name`), duplicate (`duplicate-local-name`). A row read's
*name* is not rendered — the read declares one scalar per projected
column and no variable under the row name itself — so it takes two: SQL
name, then duplicate. It is not reserved-checked, and the requirement's
existing scenario (a row read named `found` succeeds, judged by the
locals it declares) stays true.

Reserved comes first because an argument key is snake-cased before it is
checked while a loop name is checked as written, so only the loop name
can be a reserved word in a spelling the SQL-name rule would also
refuse. `FOUND` already answers `reserved-local-name` today; letting the
SQL-name rule reach it first would change a shipped code, and would
report the spelling when the name is the problem — lower-casing it does
not help. Every spelling that is not a reserved word still meets the
SQL-name rule first.

Case folding in the duplicate check is not added: a hejbro SQL name is
lower-case by definition, so two spellings that fold to one name cannot
both pass the first check. The scenario pins `Row`/`row` as refused by
the first rule.

## Q3 — Shadowing an argument

Body names live in two spaces, because two different harms are being
refused:

- the **variable space** — an argument's derived SQL name, a loop's
  record name, a row read's derived scalars (`<row>_<col>`) — holds the
  plpgsql identifiers a body actually renders. A collision here is one
  the server refuses or, worse, silently resolves to the wrong
  variable.
- the **block space** — a loop's name and a row read's name — holds the
  names the author gives the body's constructs. A collision here is
  hejbro's own: two constructs answering to one name in the same body.

A loop name is in both (it is a plpgsql record variable and a hejbro
block label). The variable space is seeded with the arguments' derived
SQL names before the body is recorded, so a loop named after an
argument, or a row read whose derived scalar is an argument's name, is
refused. A row read named after an argument is accepted: the row name
renders nowhere, and its scalars are checked on their own.

One code serves both spaces (`duplicate-local-name`); the message names
which two constructs collided — argument, loop, row, or a row's derived
local.

## Q4 — `duplicate-column`

Message only: the table refusal names both colliding keys and the shared
derived name, in the order `duplicate-argument` uses. Code unchanged.

## Q5 — `next` and `query` (review-born)

The piece review put every rendering hejbro accepts on a live server —
3,328 of them — and found exactly one the server refuses: an argument
named `next` or `query`, whose body renders `return next;` and is read
as plpgsql's own `RETURN NEXT`, so a non-SETOF function fails at
creation (42804). The whole path was reproduced through the CLI:
`hejbro generate` writes the migration and `psql -f` cannot apply it.

- (i) Leave it to a follow-up issue and narrow the requirement's
  exclusion sentence to "within what this change measured".
- (ii) Add the two names here.
- **Ruling (ii).** A generated migration that cannot be applied is the
  worst grade of defect this capability has; the fix is two entries in
  the same set, behind the same check and the same message; and it is
  the same defect family the change already exists for.

The review then measured what the break is worth: it is lexical, at one
position. `return coalesce(next, 'd')` and `return (next)` are created,
and a `returns setof` body — rendered `return query <select>` — never
puts the argument after `return` at all, so `args: { next }` works there
end to end. Refusing the two names therefore does refuse some working
declarations. That is the same trade the requirement already states as
uniform refusal (one list, one check, one message, wherever a body would
render the name), taken with its cost visible: a name whose safety
depends on which expression the author writes next is not a name a
declaration can promise. The requirement says so in place of implying
it, so that a reader who measures the setof case does not read the
sentence as false.

How the third source is written matters more than the two names.
Widening its *phrase* from "a word plpgsql opens a statement with" to "a
word of plpgsql's statement syntax" would swallow `exit` and `elsif` —
which the same requirement names as outside the class — and would put
seventeen more measured-harmless words (`continue`, `assert`, `open`,
`call`, `commit`, `rollback`, …) in line to be refused, which is the
mirror image of the relaxation this change forbids. So the phrase stays
descriptive and **the list is the definition**: sixteen refused, and the
nineteen harmless siblings named in the requirement so that no reader
mistakes the phrase for the rule. The review's regression sweep, not the
sentence, is what confirms the set moved by exactly `{next, query}`.

## Measurement (1.1)

Server: `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu`,
image `postgres:17`. Measured 2026-09-05.

### Reproduction

Category C, read straight from the running server:

```sql
SELECT word FROM pg_get_keywords() WHERE catcode = 'C' ORDER BY word;
```

Three positions a body renders a name, one template each (`<name>`
substituted per row below):

```sql
-- argument
CREATE FUNCTION app.fl_arg_<name>(<name> text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE '%', <name>;
END
$$;
SELECT app.fl_arg_<name>('probe');
```

```sql
-- loop record
DO $$
DECLARE <name> record;
BEGIN
  FOR <name> IN SELECT 1 AS v LOOP
    RAISE NOTICE '%', <name>.v;
  END LOOP;
END
$$;
```

```sql
-- row-declared local
DO $$
DECLARE <name> text;
BEGIN
  SELECT 'x' INTO <name>;
  RAISE NOTICE '%', <name>;
END
$$;
```

### Result counts, by position (81 names: the 63 category-C names, the
16 names Q1's second pass lists, `exit`, `elsif`)

| position     | harmless | syntax-error | declaration-failure |
|--------------|----------|--------------|----------------------|
| argument     | 18       | 60           | 3 (`inout`, `out`, `setof`) |
| loop record  | 72       | 8            | 1 (`declare`)        |
| row local    | 72       | 8            | 1 (`declare`)        |

"harmless" means the `CREATE`/`DO` succeeded and the probe value came
back unchanged (checked for every harmless case, not assumed).

### Category C (63 names)

All 63 fail at the argument position. 60 as `syntax-error` (e.g. `int`:
`syntax error at or near "text"`, matching the issue's own repro). The
remaining 3 fail differently: `inout`/`out` as `declaration-failure`
(`42P13: function result type must be text because of OUT parameters`)
and `setof` as `declaration-failure` (`42P13: functions cannot accept
set arguments`) — none of the 63 create successfully at the argument
position.

All 63 are harmless as a loop record name and as a row-declared local
(created, and the probed value read back unchanged in both positions).
The 63: `between, bigint, bit, boolean, char, character, coalesce, dec,
decimal, exists, extract, float, greatest, grouping, inout, int,
integer, interval, json, json_array, json_arrayagg, json_exists,
json_object, json_objectagg, json_query, json_scalar, json_serialize,
json_table, json_value, least, merge_action, national, nchar, none,
normalize, nullif, numeric, out, overlay, position, precision, real,
row, setof, smallint, substring, time, timestamp, treat, trim, values,
varchar, xmlattributes, xmlconcat, xmlelement, xmlexists, xmlforest,
xmlnamespaces, xmlparse, xmlpi, xmlroot, xmlserialize, xmltable`.

### The 16 names (Q1's second pass)

| name        | argument  | loop record       | row local          |
|-------------|-----------|--------------------|--------------------|
| exception   | harmless  | harmless           | harmless           |
| foreach     | harmless  | syntax-error        | syntax-error        |
| get         | harmless  | harmless           | harmless           |
| loop        | harmless  | syntax-error        | syntax-error        |
| perform     | harmless  | harmless           | harmless           |
| raise       | harmless  | harmless           | harmless           |
| while       | harmless  | syntax-error        | syntax-error        |
| begin       | harmless  | syntax-error        | syntax-error        |
| by          | harmless  | syntax-error        | syntax-error        |
| declare     | harmless  | declaration-failure | declaration-failure |
| execute     | harmless  | syntax-error        | syntax-error        |
| if          | harmless  | syntax-error        | syntax-error        |
| new         | harmless  | harmless (general function; see trigger note below) | harmless (general function; see trigger note below) |
| old         | harmless  | harmless (general function; see trigger note below) | harmless (general function; see trigger note below) |
| return      | harmless  | harmless           | harmless           |
| strict      | harmless  | syntax-error        | syntax-error        |

### Control: `exit`, `elsif`

Both `harmless` at all three positions (not in `pg_get_keywords()` at
all — no category, not even `U`).

### `new`/`old` in a trigger body (a plpgsql-declared variable, not a
keyword — argument position does not apply: `trigger functions cannot
have declared arguments` regardless of the name chosen)

`BEFORE INSERT ... FOR EACH ROW`, redeclaring `new` as a loop record
(`DECLARE new record; FOR new IN SELECT 1 AS v LOOP ...`): the loop
body reads the loop's own value (`loop-new.v=1`), and the redeclaration
persists past the loop — the function's own `RETURN NEW;` then returns
that leftover record, which fails with `42804: returned row structure
does not match the structure of the triggering table` because it has
one column instead of the trigger table's two.

Redeclaring `new` as a row-declared local (`DECLARE new text; SELECT
'x' INTO new;`): `RETURN NEW;` fails with `42804: cannot return
non-composite value from function returning composite type` — the
scalar has overwritten the row.

`BEFORE UPDATE ... FOR EACH ROW`, redeclaring `old` as a loop record:
after the loop ends, reading `old.v` again returns the loop's leftover
value (`1`), not the triggering row's actual `v` — silent, no error.

Redeclaring `old` as a row-declared local (`DECLARE old text; SELECT
'x' INTO old;`): the bare identifier `old` reads the shadowing scalar,
but `old.v` (dotted field access) still resolved to the real trigger
row's value in this measurement — recorded as observed, not relied on.

### Two observations against the pre-measurement class statement

- Category C names are not refused everywhere: they declare and read
  back unchanged as a loop record name and as a row-declared local —
  only the argument position fails for all 63.
- `out` does not succeed silently: with the `returns void` template
  used here, its argument list is accepted as an OUT-mode parameter,
  but function creation still fails (`42P13`), not a silent success.
