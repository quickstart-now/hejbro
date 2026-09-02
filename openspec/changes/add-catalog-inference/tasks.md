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
`packages/cli/test/infer-*.test.ts`. `check/catalog.ts` is **read, not
edited**: `readCatalog` supplies the shared inventory unchanged.

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
      predicate, enum labels, identity sequence options. Failing test:
      `infer-catalog-read.test.ts` (parameterless read-only text pinned,
      rows parsed).
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
- [ ] 1.5 (~8m) Enums, sequences, roles; the not-inferred list. Failing
      test: `infer-rest.test.ts`.
- [ ] 1.6 (~7m) The description with `guessed` marks and the loss report
      text. Failing test: `infer-description.test.ts`.

## 2. Declarations from a snapshot (#604)
Files: `packages/cli/src/declare-emit/*.ts` (new), tests

- [ ] 2.1 (~9m) [design] The source shape: one file per schema, imports,
      `schema()`/`table()`/`pgEnum()`, column builders per type family,
      foreign keys via `references`, the header comment carrying the
      loss report. Failing test: `declare-emit.test.ts` golden.
- [ ] 2.2 (~8m) Round trip: emitted source, loaded and generated against
      an empty snapshot, yields DDL equal to the fixture's objects.
      Failing test: `declare-emit-roundtrip.test.ts`.

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
