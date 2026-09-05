# Proposal: harden-function-locals (#816, #817, #818, #821, #832)

## Why

Five defects sit on one seam: the names a function body renders
unquoted. Each one lets a name reach the server that hejbro should have
refused at declaration time, or refuses it with a message that does not
say which two things collided.

1. **Category-C keywords are not refused (#832).** The reserved-name
   check covers Postgres's keyword categories R and T and the variables
   plpgsql declares itself, but the 61 column-name keywords of category
   C — `int`, `row`, `values`, `time`, `timestamp`, `json`, `out`,
   `trim`, … — fail identically as argument names (`create function
   "app"."c_int"(int text)` is a syntax error; `out` is silently reparsed
   as an OUT-mode parameter). Two of them (`between`, `exists`) already
   sit in the list, so the requirement's stated class does not
   reconstruct the shipped list either; `exit` and `elsif`, which the
   requirement's "plpgsql reserves for its own statements" phrase seems
   to cover, are harmless in every rendered position and rightly absent.
2. **Loop and row names bypass the SQL-name rule (#817).**
   `ctx.forEach(q, fn, name)` and `ctx.row(name)` render the name
   unquoted without the D36 check an argument key gets, so `"my-loop"`
   reaches the server as written.
3. **A loop or row local may shadow an argument (#816).** The body's
   name ledger is not seeded with the argument names, so `args: { x }`
   beside a loop named `x` is accepted and the loop variable shadows the
   argument silently — Postgres does not refuse it either, the loop
   variable lives in a nested block.
4. **The duplicate check is case-sensitive (#821).** `Row` and `row` pass
   as two locals and Postgres refuses the folded pair as a duplicate
   declaration. With the SQL-name rule applied to those names this shape
   cannot arise — `Row` is refused as not a hejbro SQL name before the
   duplicate check runs — and the rule says so.
5. **`duplicate-column` names one key (#818).** `duplicate-argument`
   names both colliding keys and the shared derived name; the table's
   sibling refusal names the derived name only.

## What Changes

- **The reserved class is R, T and C.** The reserved set gains every
  category-C keyword, each one measured on a live server as an argument
  name, a loop name and a row-declared local; the requirement states the
  class as the three keyword categories plus the variables plpgsql
  declares itself, and names `exit`/`elsif` as measured harmless.
- **Loop and row names are hejbro SQL names.** They go through the same
  `invalid-sql-name` refusal an argument key does, before the reserved
  and duplicate checks; a name that differs from another only by case is
  therefore refused as not a SQL name, never accepted as a second local.
- **A body local never shadows an argument.** The name ledger is seeded
  with the arguments' SQL names, and a loop or row local by such a name
  is refused with `duplicate-local-name` naming the argument.
- **`duplicate-column` names both keys**, like `duplicate-argument`.
- The function-builder skill reference gains the rules; one `patch`
  changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`plpgsql-function-bodies`** — MODIFIED requirement: *A local name is
  never one plpgsql declares itself* (the class is R, T and C; a
  category-C scenario). ADDED requirement: *A body local is a hejbro SQL
  name and never shadows an argument*.
- **`table-declaration`** — ADDED requirement: *Two column keys never
  share one SQL name* (the refusal that `function-declaration` already
  cites as the table's, now stated, naming both keys).

## Impact

- `@hejbro/core`: `plpgsql/reserved.ts` (the set), `plpgsql/
  body-context.ts` (the ledger and the name rule), `dsl/define-function.ts`
  (seeding), `dsl/table.ts` (wording); their tests, one Docker-gated
  measurement.
- `skills/hejbro`: `references/function-builder-pitfalls.md`.
