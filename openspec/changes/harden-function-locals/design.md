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

## Q2 — One rule for a local's spelling

Loop and row names take the same three checks an argument key takes, in
the same order: hejbro SQL name (`invalid-sql-name`), reserved
(`reserved-local-name`), duplicate (`duplicate-local-name`). Case
folding in the duplicate check is not added: a hejbro SQL name is
lower-case by definition, so two spellings that fold to one name cannot
both pass the first check. The scenario pins `Row`/`row` as refused by
the first rule.

## Q3 — Shadowing an argument

The ledger is seeded with the arguments' derived SQL names before the
body is recorded, so the existing duplicate refusal covers a loop or
row local by an argument's name; the message names the argument. A row
read's derived locals (`<row>_<col>`) are checked the same way.

## Q4 — `duplicate-column`

Message only: the table refusal names both colliding keys and the shared
derived name, in the order `duplicate-argument` uses. Code unchanged.
