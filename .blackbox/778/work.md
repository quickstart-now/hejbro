# Work — quickstart-now/hejbro#778

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — check compares index predicates, expression columns and generated columns through the server's rendering

_2026-09-04T15:35Z_

Built one rule that compares every table-bound expression `check` knows about — a check constraint's expression, an index's partial predicate, an index's own expression columns, and a generated column's expression — through the server's own rendering, generalized over a shared `ExpressionSurface` ({identity, describe}) instead of each surface hardcoding its own message text and probe. One statement per *object*: an index carries every pair it has (predicate pair first, then one pair per expression column) and a generated column carries one pair; `probeRenderings` reads `Output[2k]`/`Output[2k+1]` per pair from one `EXPLAIN (FORMAT JSON, COSTS OFF, VERBOSE)` statement. Under a registered preset that declares `explainUnavailable` (e.g. `@hejbro/nile`), the same fixed six-step text normalization now applies to all four surfaces (each index expression column normalized on its own), not only check constraints.

Catalog reads extended (`packages/cli/src/check/catalog.ts`): the `columns` query splits `catalogDefault`/`catalogGenerated` via `case a.attgenerated when '' then … end`; the `indexes` query gains `predicate` (`pg_get_expr(ix.indpred, ix.indrelid)`) and `expressions` (`json_agg(pg_get_indexdef(ix.indexrelid, ord.n::int, true) order by ord.n)` over `unnest(ix.indkey) with ordinality`).

Measured facts (docker postgres:17-alpine):
- `pg_get_indexdef`'s column-number parameter is `int`, with no `bigint` overload — `unnest(...) with ordinality` always yields a `bigint` ordinality column, so the uncast form fails outright ("function pg_get_indexdef(oid, bigint, boolean) does not exist"), caught only by the Docker live witness (task 1.7), never by the unit tests' fake sessions.
- `pg_attribute.attgenerated` is `''` (never `NULL`) for a plain column, `'s'` for stored-generated.
- `pg_get_indexdef(oid, n, true)` returns the bare key expression for an expression column — no `DESC`/`NULLS`/`COLLATE`/operator class.
- A combined statement's `Output` always carries every target-list entry in order, even when two entries render identically (measured directly, `SELECT (x), (x) FROM t` still returns two elements).
- `EXPLAIN`'s `Output` never shows a `COLLATE` clause even when the source SQL carried one, and folds a table-qualified and a bare reference to the same rendered text.

New surfaces wired end-to-end into `compareCheckAgainstCatalog` (`commands/check.ts`): `declaredIndexExpressions` (every index with a predicate or an expression column — a plain index is never walked) and `declaredGeneratedColumns` (every generated column), each run through the same `mode` as check constraints and merged into one findings list. The text-mode coverage-boundary line now names all four surfaces.

Live witness (task 1.7, Docker): a fixture table with a combined partial+expression index and a generated column — control passes (exit 0), three separate `psql` alterations (index predicate, index expression, generated expression) each report their own `check-object-differs` (exit 1, no `check-not-compared`), and under a local `explainUnavailable` preset the two indexes agree while the generated column (whose catalog text carries a `::numeric` cast the fixed normalization cannot strip from a column reference) is `check-not-compared`, exit 2, zero `explain` in the server log delta. `examples/postgres`'s own pre-existing partial index (`ne(t.status,'done')`-style) and expression index (`lower(email)`) now pass through real server-rendering comparison for the first time, confirmed still green.

Gates: `pnpm check` (biome, clean) · `pnpm check-types` (18/18) · `pnpm check:bans` (0 violations) · `pnpm test` (91 files / 975 tests) · `pnpm --filter hejbro test:integration` (14/14, Docker).

Commits: b1724bb1 (open change), 0c756544 (1.1 backtick delimiter), 3f930398 (1.2 catalog reads), 31d25575 (1.3 generated-column axis), 093d1563 (1.4 surface generalization + generated-column probe), 8a4262d3 (1.5 index predicate/expression compare), 10e7ff9c (1.6 wiring), 97c188a4 (1.7 int cast fix + live witness), 52a0fee2 (1.8 docs + changeset).

