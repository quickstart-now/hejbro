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

## Indexes (`compare.ts` unchanged, `expression.ts`) — ordered key list

Settled after the constructor review (`.blackbox/778/` R3): the unit of
comparison is the index's **ordered key list**, not its expression
columns. Postgres stores a declared expression that is a bare column
reference, a parenthesized column or `col collate "C"` as a *plain* key
(`indexprs` null, the collation in `indcollation`), so counting expression
columns reported a difference hejbro's own migration produces and no
migration can fix; and a declared-side filter let a database index that
grew an expression or a predicate pass as present.

- **Catalog** (`catalog.ts`): the `indexes` query returns `keys`, a JSON
  array in position order of `{ text, expression }` for every key —
  `text` = `pg_get_indexdef(ix.indexrelid, n::int, true)` (the bare key:
  a column name or the expression, never `DESC`/`NULLS`/opclass) with
  ` collate <quote_ident(collname)>` appended where `indcollation[n-1]`
  is neither 0 nor the plain column's own `attcollation` (for an
  expression key: neither 0 nor the database default collation);
  `expression` = `indkey[n-1] = 0`. Plus `predicate` as before. Measured:
  `((email))` is stored as a plain key (`indkey ≠ 0`); `pg_get_indexdef`
  with a column number omits `COLLATE` (the full form shows it); and
  `EXPLAIN`'s `Output` renders `email collate "C"` and `email` identically
  — so the collation suffix matters to the text mode only, and a
  collation-only difference is invisible to the server-mode comparison
  (stated as a limit in the delta, beside sort direction and opclass).
  Comparing a key's sort direction, operator class, collation and a
  plain column's name as attributes is #844, not this change; the
  declared side's collation sits inside raw SQL and cannot be read
  structurally, so no text-mode complement is attempted here either.
- **Comparison** (`compareIndexKeys`): absent index → nothing. Key count
  differs → one `check-object-differs` naming both counts, no probe.
  Predicate on one side only → one `check-object-differs` naming which
  side is partial. Then one statement carries the predicate pair (if
  both) and one pair per position at which *either* side is an
  expression — the declared plain column rendered as its own column
  reference, the declared expression rendered as today; each differing
  pair is its own finding (`index predicate` / `index key n`). A position
  at which both sides are plain columns is not paired (Q7 stands; a
  plain-column name mismatch stays existence-only and is tracked apart).
  Text mode normalizes each paired position on its own.
- **Wiring**: every declared index reaches the comparison — no
  declared-side filter; an index with no predicate on either side and no
  expression at any position issues no statement.
- Uniqueness and access method: untouched, still existence-only, and the
  skill's brownfield reference says so.

## Wiring (`commands/check.ts`)

- `compareCheckAgainstCatalog` runs `compareCatalog` (sync), then the three
  expression walks — `declaredCheckConstraints`, `declaredIndexExpressions`
  (every index with a `where` or an expression column),
  `declaredGeneratedColumns` — with the same `mode`, and merges findings.
- Foreign input: the catalog texts come from `pg_get_expr`/`pg_get_indexdef`
  and the renderings from `EXPLAIN`. The group's reviewer runs in
  constructor mode (D110).
