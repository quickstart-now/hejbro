## MODIFIED Requirements

### Requirement: A local name is never one plpgsql declares itself
A name hejbro renders unquoted inside a function body — an argument's
derived SQL name, the scalar locals a row read declares, a loop's record
name — SHALL be refused at declaration time with `reserved-local-name`
when it is a name Postgres reserves or plpgsql declares itself. The
class is defined by its source, not by how it fails:

- a name Postgres reserves — its own keyword table's categories `R`
  (reserved), `T` (reserved, usable as a function or type name) and `C`
  (a column-name keyword, which cannot stand as a function parameter or
  an unquoted local);
- a variable plpgsql declares on its own — `found` in every function,
  `sqlstate` and `sqlerrm` inside an exception handler, and the
  variables a trigger function receives: `tg_name`, `tg_when`,
  `tg_level`, `tg_op`, `tg_relid`, `tg_relname`, `tg_table_name`,
  `tg_table_schema`, `tg_nargs`, `tg_argv`, `tg_event`, `tg_tag`.

plpgsql's own statement words that are not Postgres keywords — `exit`,
`elsif` and their like — are not in the class: measured, they stand as
an argument, a loop name and a local in every rendered position, so
refusing them would refuse a working program.

A local by such a name either fails somewhere in the body or silently
changes what the name means, so hejbro refuses it before the body
reaches the server. Where the failure lands varies by name: a reserved
keyword breaks at creation — at the declaration, at an assignment, or
at a read of the name, depending on its category — while a variable
plpgsql declares is created without complaint and then plpgsql's own
wins: an argument named `found` is unreachable — `return found` yields
plpgsql's `FOUND`, not the caller's value — and only a `declare`d local
by that name hides plpgsql's, so a body that tests it after a statement
reads a variable the statement never set. `current_schema`,
alone among the keywords, is created without complaint too and then
resolves to the builtin in every expression position, and to the local
only where plpgsql binds it directly — a `select … into` target or
`return` — so an argument by that name is silently replaced by the
schema name inside a `where`. The declaration is the only place
every one of these is visible.

The refusal is uniform. A name is refused wherever a body would render
it and in every function alike — a `tg_*` name is refused in a plain
function as much as in a trigger — so that one list, one check and one
message serve every declaration. The comparison is by the spelling
Postgres resolves: an unquoted identifier folds to lower case, so a name
that differs from an owned one only by letter case is that name and is
refused the same way.

#### Scenario: A variable plpgsql declares itself is refused as an argument name
- **WHEN** a function declares an argument whose derived SQL name is
  `found`, `sqlstate`, `sqlerrm`, or any of the twelve `tg_*` variables
- **THEN** the declaration fails with `reserved-local-name`, naming the
  function and the name, and no declaration is produced

#### Scenario: A variable plpgsql declares itself is refused as a loop name
- **WHEN** a body names a `ctx.forEach` loop with one of those names, in
  any letter case — `found`, `FOUND`, `Found`, `tg_op`, `TG_OP`
- **THEN** the declaration fails with `reserved-local-name`, and no
  declaration is produced

#### Scenario: A row name is judged by the locals it declares
- **WHEN** a body names a `ctx.row` or `ctx.rowOrNull` read `found`
- **THEN** the declaration succeeds — a row read declares one scalar
  local per projected column (`found_id`, `found_status`), never a
  variable under the row name itself, and none of those locals is an
  owned name

#### Scenario: A keyword Postgres fully reserves is refused the same way
- **WHEN** a function declares an argument whose derived SQL name is
  `analyse`, `analyze`, `current_catalog`, `except`, `lateral` or
  `system_user`
- **THEN** the declaration fails with `reserved-local-name`, exactly as
  an argument named `select` or `order` already does

#### Scenario: A keyword reserved for function and type names is refused
- **WHEN** a function declares an argument whose derived SQL name is
  one of `authorization`, `binary`, `collation`, `concurrently`,
  `cross`, `current_schema`, `freeze`, `full`, `ilike`, `inner`, `is`,
  `isnull`, `join`, `left`, `like`, `natural`, `notnull`, `outer`,
  `overlaps`, `right`, `similar`, `tablesample` or `verbose`
- **THEN** the declaration fails with `reserved-local-name` — a body
  that assigns to or reads such a name as rendered (`raise exception
  'value %', left;`) is refused by Postgres at creation with a syntax
  error, and a body naming `current_schema` is created but resolves
  the name to the builtin in every expression position — `where
  "status" = current_schema` compares against the schema name, not the
  argument

#### Scenario: A column-name keyword is refused in every rendered position
- **WHEN** a function declares an argument, names a loop, or names a
  row read whose derived local is any keyword of category `C` — `int`,
  `row`, `values`, `time`, `timestamp`, `json`, `out`, `trim`,
  `between`, `exists` and the rest of the category, every one of them
- **THEN** the declaration fails with `reserved-local-name` — as an
  argument such a name is a syntax error at creation (`(int text)`) or
  is reparsed as a parameter mode (`out`), and as a local it cannot be
  declared unquoted — while `exit` and `elsif` are accepted in all three
  positions

#### Scenario: A name that merely contains an owned name is accepted
- **WHEN** a function declares an argument, or names a loop,
  `found_at`, `row_found`, `tg`, `tg_ops`, `sqlstate_code` or `state`,
  or names a row read `tg` whose projected columns derive no owned
  name (`tg` with a column `id` declares `tg_id`)
- **THEN** the declaration succeeds and the name renders unquoted as
  before — while the same row name with a column `op` is refused, for
  the local `tg_op` it would declare

## ADDED Requirements

### Requirement: A body local is a hejbro SQL name and never shadows an argument
A loop's record name and a row read's name SHALL be hejbro SQL
identifiers — lower-case snake_case, exactly the rule an argument key's
derived name and a column name already meet — and a name that is not
SHALL be refused at declaration time with `invalid-sql-name`, naming the
function and the name, before the reserved-name and duplicate checks
run. Two spellings that fold to one unquoted identifier therefore never
both pass: the one that is not lower-case is refused as not a SQL name,
never accepted as a second local.

The body's ledger of declared names SHALL be seeded with the function's
argument SQL names, so a loop or row local whose name — or whose
derived scalar local — is an argument's name is refused with
`duplicate-local-name`, naming the argument, exactly as a second local
of one name already is. Postgres accepts the shadowing (the loop
variable lives in a nested block), and the body then silently reads the
loop's value where the author meant the caller's; the declaration is the
only place the collision is visible.

#### Scenario: A loop or row name that is not a hejbro SQL name is refused
- **WHEN** a body names a `ctx.forEach` loop or a `ctx.row` read
  `"my-loop"`, `"Row"`, `"2nd"`, `"a b"`, `""` or a name with a
  non-ASCII letter
- **THEN** the declaration fails with `invalid-sql-name`, naming the
  function and the name, and no declaration is produced

#### Scenario: Two spellings that fold to one name never both pass
- **WHEN** a body names one row read `row_a` and another `Row_a`
- **THEN** the declaration fails with `invalid-sql-name` on `Row_a`,
  before any duplicate check, and no SQL is rendered

#### Scenario: A local by an argument's name is refused
- **WHEN** a function declares `args: { x }` and its body names a loop
  `x`, or names a row read `x` over a projection whose derived local
  would be another argument's name (`args: { x_id }`, `ctx.row("x")`
  over a column `id`)
- **THEN** the declaration fails with `duplicate-local-name`, naming the
  argument the local would shadow, and no declaration is produced

#### Scenario: Two locals of one name are refused
- **WHEN** a body names two loops `r`, or a loop `r` and a row read `r`
- **THEN** the declaration fails with `duplicate-local-name`, naming the
  function and the name
