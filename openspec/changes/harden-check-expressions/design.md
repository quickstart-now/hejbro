# Design: harden-check-expressions

Lead rulings under the owner's delegation settle the contract details
(`.blackbox/778/` R2, `.blackbox/781/` R1, `.blackbox/779/` R1); the delta
spec carries the contract, this file carries the shape the implementation
takes. Every server fact below was measured on `postgres:17-alpine`.

## One comparison, four surfaces (`expression.ts`)

- **Surface**: a value `{ identity, describe, schema, table, declaredExpression,
  catalogText }` where `describe` is one of `check constraint`,
  `index predicate`, `index expression column <n>`, `generated column`.
  The probe, the text comparison and the three finding shapes (differs,
  not-compared with texts, not-compared for a failed rendering) take a
  surface; `compareCheckConstraint` becomes the check-constraint caller
  of the same functions, plus its own `pg_constraint` read and the
  enforcement finding. Server mode is byte-for-byte what it was for a
  check constraint.
- **Probe**: unchanged form —
  `explain (format json, costs off, verbose) select (<declared>), (<catalog>), … from <schema>.<table>`.
  One statement per *object*: an index carries every pair it has
  (predicate pair first, then one pair per expression column) and reads
  `Output[2k]`/`Output[2k+1]`; a generated column carries one pair. Measured:
  `Output` keeps every target-list entry in order (six entries verified),
  renders `"t"."email"` and `email` identically, and never folds equal
  entries. The declared side renders through `renderExpr` in server mode
  and `renderTableBoundExpr` in text mode, as today.
- **Text mode**: `normalizeCheckText` applied unchanged, each expression
  column of an index on its own. No seventh step: a generated column whose
  catalog text carries a column cast (`(price * (qty)::numeric)`) is
  not-compared on such a platform, the same class as #782 and decided
  there. The boundary line becomes "expressions (check constraints, index
  predicates and expression columns, generated columns) were compared by
  normalized text on this run, …".
- **Delimiter**: every expression text in a finding message is wrapped in
  backticks — the four sites: the server-mode not-compared (both texts),
  the text-mode not-compared, the differs message ("renders as `…`, but …
  renders as `…`"). Codes and `Next:` unchanged. Backticks already wrap
  commands in these messages and cannot be a SQL quote character.

## Catalog reads (`catalog.ts`)

- **Columns**: the bulk query gains `a.attgenerated` and splits
  `pg_get_expr(ad.adbin, ad.adrelid)` into `catalogDefault` (when
  `attgenerated = ''`) and `catalogGenerated` (otherwise), exactly one of
  them non-null. Measured: a plain column's `attgenerated` is the empty
  string, never null; a stored generated column's is `'s'`; both kinds
  share `pg_attrdef`.
- **Indexes**: the bulk query gains `predicate` (`pg_get_expr(ix.indpred,
  ix.indrelid)`, null for a plain index) and `expressions` — a JSON array,
  in index-column order, of `pg_get_indexdef(ix.indexrelid, n, true)` for
  every position `n` where `indkey[n-1] = 0` (the `json_agg … order by n`
  idiom the constraints query already uses). Measured: with a column
  number, `pg_get_indexdef` returns the bare key expression — no
  `DESC`/`NULLS`/`COLLATE`/operator class — so a declared expression column
  and its catalog text are the same kind of thing. No per-object statement
  is added; both reads stay role-independent catalog reads.

## Generated columns (`compare.ts` + `expression.ts`)

- `compareColumn` gains a generated axis and loses the default axis for a
  column generated on either side: declared `generated` with a catalog
  `catalogGenerated === null` → one `check-object-differs` ("declared column
  … is generated always as `…` stored, but the database's column is not
  generated"; the catalog default, if any, is named in the message);
  declared plain with a catalog `catalogGenerated !== null` → one
  `check-object-differs` the other way. A column generated on both sides
  produces no finding from `compare.ts`; its expression is
  `compareGeneratedColumn`'s (async, `expression.ts`), catalog text straight
  from the already-read column row, so no new read. Missing column/table →
  `compare.ts`'s existing missing finding, nothing from the expression path.

## Indexes (`compare.ts` unchanged, `expression.ts`)

- `compareIndexExpressions` reads the index's own catalog row. Absent →
  nothing (existence already reported). Expression-column count differs →
  one `check-object-differs` naming both counts, no probe. Predicate on one
  side only → one `check-object-differs` naming which side is partial.
  Otherwise one statement carries every pair; each pair that differs is
  its own finding (`index predicate` / `index expression column n`), so
  every axis is reported from one run. Plain columns, uniqueness, method:
  untouched, still existence-only, and the skill's brownfield reference
  says so.

## Wiring (`commands/check.ts`)

- `compareCheckAgainstCatalog` runs `compareCatalog` (sync), then the three
  expression walks — `declaredCheckConstraints`, `declaredIndexExpressions`
  (every index with a `where` or an expression column),
  `declaredGeneratedColumns` — with the same `mode`, and merges findings.
- Foreign input: the catalog texts come from `pg_get_expr`/`pg_get_indexdef`
  and the renderings from `EXPLAIN`. The group's reviewer runs in
  constructor mode (D110).
