# Tasks: add-catalog-inference (#604)

Piece team. Base: dev at branch creation. Groups are file-disjoint;
1 → 2 → 3 → 4 → 5. (3 and 4 both register their command in `main.ts`'s
one `subCommands` map, so they are sequential, not parallel — measured
on the branch tip, not assumed from the file list. There is no
diagnostics registry to share: a code is a string literal at the site
that raises it, and `check:diagnostic-xref` reads docs citations
against those literals.)

## 1. The reading (#604)
Files: `packages/cli/src/infer/*.ts` (new — including inference's own
read-only catalog queries for the facts `check` never needed),
`packages/cli/test/infer-*.test.ts`,
`packages/cli/test/infer-catalog-read.integration.test.ts`.
`check/catalog.ts` is **read, not edited**: `readCatalog` supplies the
shared inventory unchanged.

The reading builds declarations with core's public DSL (`schema`,
`table`, `pgEnum`, `sql.raw`) and takes the snapshot and the export
description from the existing serializer and
`buildExportDescription` — never by assembling snapshot JSON, which
would need a core export (`encodeExprNode`) that does not exist on the
public surface.

- [ ] 1.1 (~9m) [design] Settled with the lead: the key casing and
      collision-suffix rules (now stated in the `catalog-inference`
      delta, which owns them), default → `sql.raw` verbatim,
      `attidentity` → identity kind, `attgenerated` → generated. Write
      them as the module's rules. Failing test: `infer-keys.test.ts`.
- [ ] 1.2 (~10m) Inference's own read-only catalog reads: column
      position/`attidentity`/`attgenerated`, foreign-key targets and
      actions, check expressions, index columns/uniqueness/method/
      predicate/operator class/sort options and expression bodies, enum
      labels, identity sequence options. Failing test:
      `infer-catalog-read.test.ts` (parameterless read-only text pinned,
      rows parsed).
- [ ] 1.2b (~10m) The same reads proved against a real database, not a
      string-matching fake: one fixture carrying an enum, an identity
      column with non-default options, a stored generated column, a
      self-referencing foreign key and one with `on delete cascade`, a
      check, an expression index, a partial unique index, a GIN index
      with `jsonb_path_ops`, and a descending/nulls-first index column.
      Failing test: `infer-catalog-read.integration.test.ts` (group 1
      owns this file; group 5's witness is a separate one), on the
      ephemeral-container harness `check-live.integration.test.ts`
      already uses.
- [ ] 1.3 (~9m) Columns → declarations: type → builder, defaults,
      identity (options only where they differ from Postgres's own),
      generated, not-null; a type no builder expresses is omitted and
      recorded as a loss. Failing test: `infer-tables.test.ts`.
- [ ] 1.4 (~9m) Table-level: primary key, unique, foreign keys (a
      self-referencing one included), checks, indexes — an index's
      expression columns, partial predicate, access method and operator
      class among them, since `examples/postgres` declares all four and
      group 5's witness reads that database. Failing test:
      `infer-constraints.test.ts`.
- [ ] 1.4b (~7m) A foreign key to another table, and a cycle between
      two, with core's `existingTable` (D41) as the target handle —
      reference-only, so there is no build order to get right and no
      cycle to break. A UNIQUE constraint rides on its backing index,
      which carries the constraint's own name; the fixture proves that
      rather than asserting it. Failing test: `infer-constraints.test.ts`
      (the target's identity string in the foreign-key snapshot, and the
      handle appearing in no snapshot of its own).
- [ ] 1.5 (~8m) Enums, sequences, roles; the not-inferred list, with
      exactly the delta's own members. Failing test: `infer-rest.test.ts`.
- [ ] 1.5b (~7m) The three kinds of sequence told apart by ownership
      (`pg_depend`, deptype `i` and `a`), since the loss report may not
      claim a loss that did not happen: one an identity column owns
      (carried as that column), one a serial-family column owns (carried
      as `smallserial`/`serial`/`bigserial`, which the DSL synthesizes a
      sequence from), and one no column owns (not inferred, named).
      Failing test: `infer-rest.test.ts`, over a fixture holding all
      three.
- [ ] 1.5c (~6m) A `nextval` default naming a sequence the column does
      not own stays a raw default and is named as an approximation —
      the serial mapping applies to owned sequences only. Failing test:
      `infer-tables.test.ts`.
- [ ] 1.6 (~9m) The description, built from the catalog reading itself
      rather than from the declarations, so a column no declaration key
      can name is still carried with its guessed key (the collision
      suffix is reachable only here). Failing test:
      `infer-description.test.ts`.
- [ ] 1.7 (~8m) The loss report text: what was guessed, what was not
      inferred, the approximations (a UNIQUE constraint as a unique
      index), and the columns left undeclarable. The last of those rests
      on a measurement, not on reading the DSL, and the measurement is
      in: a quoted `"createdAt"` column is read from the catalog with
      its spelling intact, keys as `createdat`, and `generateMigration`
      then creates `"createdat"` — neither the original nor
      `created_at`. The report's wording follows that observation.
      Failing test: `infer-loss-report.test.ts`.

## 2. Declarations from a snapshot (#604)
Files: `packages/cli/src/declare-emit/*.ts` (new), tests

- [ ] 2.1 (~10m) [design, settled] The source shape: one file per
      schema, named `<schema>.schema.ts` (only the file name is made
      safe, and the original schema name goes in the loss report);
      named imports from `hejbro`, alphabetical, only the symbols the
      file uses — the barrel carries vocabulary only (#471), so an
      engine symbol appearing there is itself a failure; declaration
      order `schema()` → `pgEnum()` (labels in catalog order) →
      `table()` in foreign-key topological order, a cycle written with
      the column-level `.references(() => …)` thunk; a fixed builder
      chaining order, so the output is deterministic; `index(...)` and
      `check(...)` carrying their catalog names; and a header comment
      holding the loss report in full plus the sentence that this file
      is now the repository's own. Failing test: `declare-emit.test.ts`
      — a golden, **and** the emitted source loaded and run through
      `generateMigration`, its DDL compared object by object against the
      fixture database's own (a golden proves the strings; only running
      it proves the module).
- [ ] 2.2 (~8m) Round trip over the examples' own database rather than
      the fixture: emitted source, loaded and generated against an empty
      snapshot, yields DDL equal to that database's objects. Failing
      test: `declare-emit-roundtrip.test.ts`.

## 3. The import command (#604)
Files: `packages/cli/src/commands/import.ts` (new — its codes are string
literals at their own raise sites), `main.ts` (registers `import`),
`packages/cli/test/import-command.test.ts`

- [ ] 3.1 (~8m) Connection sourcing as `check`; refuse-before-write on
      any existing file; write; print the report. Failing tests: the two
      scenarios.

## 4. The pull command and the marked contract (#604)
Files: `packages/cli/src/commands/pull.ts` (new — its codes, and the
refusal's, are literals at their own raise sites), `main.ts` (registers
`pull`, after group 3's edit to the same map), `contract/emit.ts`
(origin variant), `vendor/state.ts`, `commands/{outdated,vendor}.ts`
(refusal), tests

- [ ] 4.1 (~9m) [design] The origin shape for a database source and the
      header line; the refusal code. Failing tests: `pull-command.test.ts`,
      `outdated` refusal test.

## 5. The live witness and the docs (#604)
Files: `packages/cli/test/*.integration.test.ts`, `skills/hejbro/
references/brownfield-adoption.md`, the polyrepo reference,
`.changeset/*.md`

- [ ] 5.1 (~9m) Import the examples' postgres database (applied with the
      examples' own chain), generate against empty, compare objects with
      the examples' snapshot; pull a contract and read one table through
      it. Both majors.
- [ ] 5.2 (~5m) Skill sentences (the guide's "does not exist" paragraph
      becomes the import paragraph), `minor` changeset, ledger rows.

## Verification (definition of done, not a task)
`openspec validate add-catalog-inference --strict`; `show --diff` zero
warnings; `TURBO_FORCE=1 pnpm check / check-types / test / check:bans /
check:crap`; `pnpm build --force` then the subprocess suites and
`test:integration` on both majors; the D106 gate before archive.
