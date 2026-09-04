## ADDED Requirements

### Requirement: A local name is never one plpgsql declares itself
A name hejbro renders unquoted inside a function body — an argument's
derived SQL name, the scalar locals a row read declares, a loop's record
name — SHALL be refused at declaration time with `reserved-local-name`
when it is a name Postgres reserves or plpgsql declares itself. The
class is defined by its source, not by how it fails:

- a name Postgres reserves — its own keyword table's categories `R`
  (reserved) and `T` (reserved, usable as a function or type name) —
  or plpgsql reserves for its own statements;
- a variable plpgsql declares on its own — `found` in every function,
  `sqlstate` and `sqlerrm` inside an exception handler, and the
  variables a trigger function receives: `tg_name`, `tg_when`,
  `tg_level`, `tg_op`, `tg_relid`, `tg_relname`, `tg_table_name`,
  `tg_table_schema`, `tg_nargs`, `tg_argv`, `tg_event`, `tg_tag`.

A local by such a name either fails somewhere in the body or silently
changes what the name means, so hejbro refuses it before the body
reaches the server. Where the failure lands varies by name: a reserved
keyword breaks at creation — at the declaration, at an assignment, or
at a read of the name, depending on its category — while a variable
plpgsql declares is created without complaint and read as the user's
local instead of plpgsql's own, so a body that tests `found` after a
statement reads a variable the statement never set. `current_schema`,
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

#### Scenario: A name that merely contains an owned name is accepted
- **WHEN** a function declares an argument, or names a loop,
  `found_at`, `row_found`, `tg`, `tg_ops`, `sqlstate_code` or `state`,
  or names a row read `tg` whose projected columns derive no owned
  name (`tg` with a column `id` declares `tg_id`)
- **THEN** the declaration succeeds and the name renders unquoted as
  before — while the same row name with a column `op` is refused, for
  the local `tg_op` it would declare
