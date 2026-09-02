# Delta: cli-commands

## ADDED Requirements

### Requirement: import writes starter declarations from a database
The CLI SHALL provide an `import` command that reads a database through
the catalog (connection from `--url`, else `DATABASE_URL`, never from
`hejbro.config.ts` — the rule `check` follows) and writes one starter
declaration file per schema into a directory the command names,
refusing to overwrite any existing file. The files SHALL declare what
the reading inferred with the DSL's own builders, and the command SHALL
print the loss report. A column whose SQL name no declaration key can
produce — the DSL derives a column's SQL name from its key by
snake_case — SHALL be omitted from the starter files and named in the
loss report together with its consequence: the table is only partly
declared, and `check` reports that column until it is declared by hand
or renamed in the database. A `generate` against an empty snapshot after an
`import` SHALL emit the DDL that creates what the database already has,
which `baseline` then registers.

#### Scenario: A database is imported into starter files
- **WHEN** `hejbro import --url <db> --out src/schema` runs against a
  database with two schemas
- **THEN** two declaration files are written, the loss report is
  printed, and a following `generate` against an empty snapshot emits a
  migration whose objects match the database's

#### Scenario: a column the DSL cannot name is left out and said so
- **WHEN** a table holds a column whose SQL name no declaration key can
  produce, such as a quoted `"createdAt"` (the DSL derives a column's
  SQL name from its key by snake_case)
- **THEN** the starter file leaves that column out, the loss report
  names it and its table, and states the consequence: the table is only
  partly declared, and `check` reports that column until it is declared
  by hand or renamed in the database

#### Scenario: import never overwrites
- **WHEN** the output directory already holds a file `import` would
  write
- **THEN** it fails with a coded diagnostic naming the file and writes
  nothing

### Requirement: pull reads a database as the marked fallback
The CLI SHALL provide `pull --db-url <url>` that feeds a catalog reading
to the same contract emitter `vendor` uses, writes the contract with an
origin naming the database rather than a commit, and prints the loss
report naming `link` as the way out. It SHALL use no other source of
schema than the catalog.

#### Scenario: A contract is pulled from a database
- **WHEN** `hejbro pull --db-url <db>` runs
- **THEN** a contract is written whose header says it was inferred from
  a database, whose `Tables` are the inferred tables with guessed keys,
  and the loss report is printed
