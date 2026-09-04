# Tasks: harden-check-expressions

Tracking issues: #778, #779, #781 (the bug issues themselves; one change,
one PR). One group, one team, tasks in order — every task touches
`packages/cli` only, and the later tasks build on the earlier ones'
exports. The group's reviewer runs in constructor mode: the input (the
catalog's `pg_get_expr`/`pg_get_indexdef` text and `EXPLAIN`'s rendering)
is foreign to hejbro's own output (D110).

Definition of done for every task: `pnpm check`, `pnpm check-types`,
`pnpm check:bans`, `pnpm test` green (`TURBO_FORCE=1` in this worktree;
`pnpm build --force` first when a subprocess suite runs); the delta
scenarios of `openspec show harden-check-expressions --diff` hold.

## 1. `check` compares every table-bound expression by one rule (#778 · #779 · #781)

- [x] 1.1 [design] ~7m — Red: `packages/cli/test/check-expression.test.ts`
  new describe "3.8 expression texts are delimited by backticks" with an
  input table over the three message sites (server-mode not-compared with
  both texts, text-mode not-compared, differs) × declared expressions that
  begin with a quoted identifier (`"posts"."role" = 'owner'`), carry a
  double quote inside a literal (`'"json"'`), and carry a backtick-free
  cast: each text appears as `` `<text>` `` and never as `"<text>"`; the
  finding's `code` and the `Next:` substring are unchanged (asserted
  against the pre-change strings). Green: the four template sites in
  `expression.ts` (`notComparedFinding`, `notComparedByTextFinding`, the
  `differsFinding` message).
  Files: `packages/cli/src/check/expression.ts`, the test.
- [x] 1.2 ~9m — Red: `packages/cli/test/check-catalog.test.ts` "columns and
  indexes carry expression texts": the fake session's `columns` rows carry
  `catalogGenerated` and the parsed `Catalog` exposes it beside
  `catalogDefault`; `indexes` rows carry `predicate: string | null` and
  `expressions: string[]`; the pinned query texts contain `attgenerated`,
  `indpred` and `pg_get_indexdef`. Green: `columnRow`/`indexRow` zod shapes,
  the two bulk queries (`case a.attgenerated when '' then … end` split,
  `json_agg(pg_get_indexdef(ix.indexrelid, k.n, true) order by k.n)` over
  `unnest(ix.indkey) with ordinality` where `k.attnum = 0`, `coalesce`d to
  `'[]'::json`), and the mechanical `catalogGenerated: null` /
  `predicate: null, expressions: []` additions to every `ColumnRow`/
  `IndexRow` literal in `packages/cli/test/*.test.ts` (check-compare,
  check-command, assert-schema, infer-*, contract-from-catalog).
  Files: `packages/cli/src/check/catalog.ts`, the tests.
- [x] 1.3 [design] ~9m — Red: `packages/cli/test/check-compare.test.ts` new
  describe "a generated column's own axis" with an input table: declared
  `generatedAlwaysAs(sql\`price * qty\`)` vs catalog `catalogGenerated:
  "(price * (qty)::numeric)"` → no finding from `compareCatalog`; declared
  generated vs catalog plain with no default → one `check-object-differs`
  whose message names the generation and whose `Next:` never says "add the
  default"; declared generated vs catalog plain with `catalogDefault:
  "'x'::text"` → exactly one finding (never a second on the default axis);
  declared plain vs catalog generated → one `check-object-differs` naming
  the database's expression; declared plain with a default vs catalog plain
  with the same default → no finding (regression). Green: `compareColumnGenerated`
  and the default axis skipped when either side is generated, in `compareColumn`.
  Files: `packages/cli/src/check/compare.ts`, the test.
- [x] 1.4 [design] ~10m — Red: `packages/cli/test/check-expression.test.ts`
  new describe "4.1 a generated column's expression" with an input table
  over `compareGeneratedColumn(session, catalog, schema, table, column,
  declaredExpression, mode)`: server agree (`Output` pair equal) → `[]`;
  server differ (`(price * (qty)::numeric)` vs `(price + (qty)::numeric)`) →
  one `check-object-differs` naming "generated column"; server explain
  error → one `check-not-compared` with backticked texts and the EXPLAIN
  `Next:`; text agree (`"widgets"."price" * "widgets"."qty"` vs
  `(price * qty)`); text not compared (`(price * (qty)::numeric)`, `Next:`
  without EXPLAIN); a column row with `catalogGenerated: null` or absent →
  `[]` and zero statements; exactly one `explain` statement in server mode.
  Green: the surface type, `probeRenderings` generalized over pairs,
  `compareByText`/finding builders taking a surface, `compareCheckConstraint`
  rerouted through them (its existing tests stay green byte-for-byte), and
  the new export.
  Files: `packages/cli/src/check/expression.ts`, the test.
- [x] 1.5 [design] ~10m — Red: `packages/cli/test/check-expression.test.ts`
  new describe "4.2 an index's predicate and expression columns" with an
  input table over `compareIndexExpressions(session, catalog, schema, table,
  index, mode)`: partial predicate rewrite agrees (`ne(t.status,'done')`
  vs `(status <> 'done'::text)`); predicate differs (`is null` vs
  `IS NOT NULL` renderings); expression agrees (`lower(email)`); expression
  differs (`upper(email)`); expression-column count differs (declared
  `on(sql\`lower(${t.email})\`)` vs catalog `expressions: []`) → one
  `check-object-differs` naming both counts and zero `explain`; predicate on
  one side only → one `check-object-differs`; predicate + two expression
  columns in one index → exactly one `explain` statement with six `Output`
  entries and one finding per differing pair; text mode agree/not compared
  for a predicate and for an expression column; an index absent from
  `catalog.indexes` → `[]`, zero statements. Green: the export, count and
  presence checks before the probe, pair layout `[pred?, e1, e2, …]`.
  Files: `packages/cli/src/check/expression.ts`, the test.
- [x] 1.6 ~9m — Red: `packages/cli/test/check-command.test.ts` "every
  expression surface reaches the run": a snapshot with a partial index, an
  expression index and a generated column (no checks) through
  `compareCheckAgainstCatalog` with a fake session — server mode issues
  exactly two `explain` statements (one per object), text mode none; with
  agreeing fake `Output`s `renderCheckReport` exits 0 and names no column
  (#781 end-to-end); the text-mode boundary line reads "expressions
  (check constraints, index predicates and expression columns, generated
  columns) were compared by normalized text"; `checkComparisonMode` tests
  unchanged. Green: `declaredIndexExpressions`, `declaredGeneratedColumns`,
  the merge in `compareCheckAgainstCatalog`, `TEXT_MODE_BOUNDARY_LINE`.
  Files: `packages/cli/src/commands/check.ts`, the test.
- [x] 1.7 ~9m — Red: `packages/cli/test/check-live.integration.test.ts`
  (Docker) new describe "expression surfaces live witness": a fixture
  project declaring `tasks` with a partial index (`where ne(status,
  'done')`), an expression index (`lower(email)`) and a generated column
  (`price * qty`), generated and applied → `check` exits 0 (control);
  after the database's index predicate, expression and generation
  expression are each altered by `psql` → exit 1 with three
  `check-object-differs` naming `<schema>.tasks.<index>` twice and the
  column once, no `check-not-compared`; the same fixture under a local
  `explainUnavailable` preset → the predicate and the expression index
  agree, the generated column is `check-not-compared`, exit 2, zero
  `explain` in the server log delta. The existing "no differences for the
  example's own declarations (6.2)" now also covers `examples/postgres`'s
  real partial and expression indexes and must stay green. Green: nothing
  beyond 1.1–1.6 unless the witness finds a gap.
  Files: the integration test.
- [x] 1.8 ~6m — Red: none runnable (documentation); the definition of done
  is `openspec validate harden-check-expressions --strict` green and
  `pnpm check:crap`/`pnpm check:tasktime` clean. Green:
  `skills/hejbro/references/brownfield-adoption.md` ("indexes are checked
  for existence only" → existence plus predicate and expression columns;
  generated columns compared by expression; plain columns/uniqueness/method
  existence-only; exit-2 row names expressions), `skills/hejbro/references/nile-preset.md`
  (the text-comparison section covers every expression surface),
  `.changeset/harden-check-expressions.md` (`"hejbro": patch`).
  Files: the two references, the changeset.
