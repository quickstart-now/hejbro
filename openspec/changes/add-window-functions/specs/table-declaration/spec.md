# table-declaration (delta)

## ADDED Requirements

### Requirement: Declaration-site expressions refuse window functions
A window function SHALL be refused where a declaration stores an
expression — a column default, a generated column, a `check` constraint,
an index expression, an index predicate, and a policy's `using`/`with
check` — because Postgres rejects a window function in every one of them.

The refusal SHALL happen when the declaration is built, naming the site
and what to do instead. Leaving it to the database would mean a
declaration that type-checks, a migration that is generated and
committed, and a failure that appears only when that migration is
applied — a broken file already in the repository.

#### Scenario: A check constraint refuses a window function
- **WHEN** a `check` constraint's expression contains a window function
- **THEN** the declaration fails immediately, naming the constraint and
  the reason, and the migration is never generated

#### Scenario: An index predicate refuses a window function
- **WHEN** a partial index's `where` contains a window function
- **THEN** the declaration fails immediately, naming the index

#### Scenario: A column default refuses a window function
- **WHEN** a column's default expression contains a window function
- **THEN** the declaration fails immediately, naming the column — a site
  no subquery guard covers today, so the refusal is its own

#### Scenario: A policy refuses a window function
- **WHEN** a policy's `using` or `with check` contains a window function
- **THEN** the declaration fails immediately, naming the policy

#### Scenario: The diagnostic is distinct from the subquery one
- **WHEN** a site refuses a window function
- **THEN** the error names window functions specifically rather than
  reusing the subquery diagnostic that guards the same sites
