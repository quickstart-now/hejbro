# Tasks: add-catalog-inference (#604)

Piece team. Base: dev at branch creation. Groups are file-disjoint;
1 → 2 → {3, 4} → 5 (3 and 4 depend on 1 only; 5 needs all).

## 1. The reading (#604)
Files: `packages/cli/src/infer/*.ts` (new), `packages/cli/src/check/
catalog.ts` (extend only if a column fact is not already read),
`packages/cli/test/infer-*.test.ts`

- [ ] 1.1 (~9m) [design] The casing and collision rules for guessed
      keys; what `identity`/`generated`/default expressions map to when
      the DSL cannot express them (record as raw `sql` default vs. drop
      with a loss line). Failing test: `infer-keys.test.ts`.
- [ ] 1.2 (~9m) Catalog rows → table snapshot nodes (columns, pk, fks,
      checks, indexes). Failing test: `infer-tables.test.ts` over a
      recorded catalog fixture.
- [ ] 1.3 (~7m) Enums, sequences, roles; the not-inferred list. Failing
      test: `infer-rest.test.ts`.
- [ ] 1.4 (~6m) The description with `guessed` marks and the loss report
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
Files: `packages/cli/src/commands/import.ts` (new), `main.ts`,
diagnostics registry, `packages/cli/test/import-command.test.ts`

- [ ] 3.1 (~8m) Connection sourcing as `check`; refuse-before-write on
      any existing file; write; print the report. Failing tests: the two
      scenarios.

## 4. The pull command and the marked contract (#604)
Files: `packages/cli/src/commands/pull.ts` (new), `contract/emit.ts`
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
