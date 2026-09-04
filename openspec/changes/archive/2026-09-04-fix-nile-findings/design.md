# Design: fix-nile-findings

Lead rulings R61–R65 (`.agents/lead-rulings-0.2.x.md`, under the owner's
delegation of 2026-09-04) settle the contract details below; the delta specs
carry the contract, this file carries the shape the implementation takes.

## Table-bound rendering (group 1)

- **Form**: `"table"."column"`, not bare. Bare would be captured by an inner
  row source inside a policy's correlated subquery (`exists (select 1 from
  projects where … = project_id)` resolves innermost-first); two-part is
  accepted by Postgres and measured on Nile (#754's table), and it keeps the
  table visible to a reviewer.
- **Mechanism**: a render-time scope marker, sibling of `DeclaredCteMarker`
  — never a stored AST node — placed in the scope array by a new exported
  entry point `renderTableBoundExpr(node, outerScope?)`. The column-reference
  arm renders two-part when the marker is in scope, unless another table in
  scope shares the bare table name under a different schema (then the
  three-part form stands). Nested `select` renderers already extend the scope
  they receive, so the marker reaches subqueries without new plumbing. Column
  refs to a CTE (`schemaName === null`) are unaffected.
- **Callers**: `checkExpression`, `indexWhere`, `indexColumnExpression`,
  `columnGenerated` in `table-snapshot.ts`; `policyUsing`/`policyWithCheck`
  (marker beside the existing outer-scope table ref); `column-order.ts`'s
  declared-side render (must use the same entry so the rebuild comparison
  compares like with like). `columnDefault` is untouched: Postgres forbids a
  column reference in a default. `index-builder.ts`'s diagnostic description
  is a message, not SQL — untouched.
- **Snapshot**: no field changes, no `formatVersion` bump. Goldens:
  `examples/postgres` and `examples/supabase` migration files regenerate
  (their chain tests compare text); the committed snapshots do not change.
- **Out of scope, filed**: view bodies and query-builder statements keep
  three-part references (query-builder spec); whether Nile accepts them on a
  tenant-aware table is unmeasured.

## `check` without EXPLAIN (group 2)

- **Declaration**: `Preset.explainUnavailable?: true` in
  `packages/core/src/engine/preset.ts` — data on the preset value, optional,
  absent meaning the platform plans. Not a driver capability (the capability
  set is fixed at two by owner decision) and not on the driver: `check` opens
  the vanilla `@hejbro/pg` driver itself and never sees a preset's decorator.
  The CLI's `isPreset` shape check needs no change (optional field).
- **Selection**: `check` reads `config.presets.some((p) => p.explainUnavailable
  === true)` once and threads a comparison mode (`"server" | "text"`) into
  `compareCheckConstraint`. The server path is byte-for-byte what it is today.
- **Normalization** (both sides, in this order): collapse whitespace outside
  string literals; strip exactly one enclosing parenthesis pair when it wraps
  the whole text; strip the enclosing table's qualifier from a column
  reference (`"projects"."name"` / `"lab"."projects"."name"` → `"name"`);
  unquote an identifier only when it is a plain lower-case identifier that
  Postgres would render unquoted; strip a `::type` cast the server appended
  directly to a string literal; fold letter case to lower **outside** quoted
  identifiers and string literals (lead ruling R80, after the review measured
  the catalog re-rendering `is not null` as `IS NOT NULL`) — SQL is
  case-insensitive outside quotes and the server already folds an unquoted
  identifier, so this is the one addition that cannot change a meaning:
  `'Done'` ≠ `'done'` and `"Name"` ≠ `"name"` stay unequal. Nothing else — in
  particular no paren removal inside the text, because that can equate
  different meanings.
- **Outcome**: equal → agrees (no finding); unequal → `check-not-compared`
  finding carrying both texts and a `Next:` naming the restatement in the
  catalog's spelling. Never a `differs` from text. The coverage boundary gains
  one line for the run: check-constraint expressions were compared by
  normalized text because the preset declares the platform cannot plan a
  statement, and a spelling difference the server would treat as equal is
  reported as not compared.
- **Foreign input**: the catalog text comes from `pg_get_expr`. The group's
  reviewer runs in constructor mode (D110).
