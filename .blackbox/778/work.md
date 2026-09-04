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

<a id="w2"></a>
## W2 — review round 1: index compared as an ordered key list

_2026-09-04T16:45Z_

Review round 1 (constructor mode, real `postgres:17-alpine`) found three blocking gaps in the 1.5/1.6 implementation, all traced to one root cause: the unit of comparison was "expression columns", not the index's whole ordered key list.

**B1/B2 — a declared-side filter dropped a plain index outright.** `commands/check.ts`'s `declaredIndexExpressions` only walked a declared index that itself carried a predicate or an expression column (`hasExpressionSurface`), so a database index that *grew* a predicate or an expression key the declaration never had — the reverse direction of the bug this whole change exists to fix — was never even passed to the comparator, and `check` reported "no differences" for a real drift. Fix: the filter is gone; every declared index reaches `compareIndexKeys`, which already had (task 1.5) a `pairSources.length === 0` guard that costs zero statements for a genuinely plain-vs-plain index, so removing the filter adds no probe traffic for the common case.

**B3 — counting expression columns reported a difference no migration could fix.** Postgres stores a bare column reference (`(email)`), a parenthesized column, or a column with an explicit collation as a *plain* key (`indexprs` is null for that position) — never as an expression, regardless of how hejbro's own declaration renders it. `compareIndexExpressions`' own "expression-column count" axis therefore permanently disagreed with a database that was generated by hejbro's own migration and never touched by hand. Fix (lead ruling, `.blackbox/778/` R3): the comparison unit is the ordered key list — key-list length first (both directions), then predicate presence (both directions), then, for every position at which *either* side is an expression, one paired rendering. A declared plain column is rendered as its own column reference (`renderPlainKeyReference`, since there is no `ExprNode` to decode for a plain key) so it can pair against a catalog expression key; a declared `sql`-tagged bare/paren/collate expression pairs against a catalog plain key the same way, agreeing because both render to the same text.

Measured facts (docker postgres:17-alpine) that shaped the catalog read and the pairing rule:
- `((email))` and `(email collate "C")` are both stored as plain keys (`indexprs` null) — only a genuine function/operator expression (`lower(email)`) is stored as `indexprs`.
- `pg_get_indexdef(indexrelid, n, true)` (the per-column form this comparison already used) never renders a `COLLATE` clause, even when the position genuinely carries one — the whole-index form (`pg_get_indexdef(indexrelid)`, no column number) does. The catalog query appends its own ` collate "<name>"` suffix from `pg_index.indcollation[n-1]` (0-based, confirmed correct against `pg_attribute.attcollation`) when that collation is neither `0` nor the position's own default (the column's `attcollation` for a plain key, the database default collation OID `100` for an expression key).
- `EXPLAIN`'s own `Output` drops a `COLLATE` clause from *both* sides alike (`email collate "C"` and `email` render identically in `Output`) — so a collation-only difference is invisible to the server-mode comparison, a limitation now stated in the delta spec and design.md, and pinned by its own test rows (server mode agrees regardless of the catalog's collation suffix; text mode, which normalizes the declared and catalog *texts* rather than reading `EXPLAIN`, does not share this blind spot and reports the mismatch `check-not-compared`).

Input table (`check-expression.test.ts` "4.2", `check-command.test.ts` "1.9"/"1.10"): key count 2↔3 and 3↔2 (both directions, zero probe), predicate present-on-one-side both directions (zero probe), plain×plain (no pair, zero statements), plain×expression and expression×plain (B1/B2's own shape, one pair), bare/paren/collate declared expression against a catalog plain key (B3, agrees), a predicate plus two expression positions in one index (one `explain`, six `Output` entries, one finding per differing pair), text mode per position, an absent index (`[]`, zero statements).

Live witness (Docker, `check-live.integration.test.ts`): a bare column reference, a parenthesized column and a collated column declared as index keys round-trip through `generate` → `psql` apply → `check`, exiting 0 with no finding — B3 proved against a real server, not only a fake session. A database index recreated on `lower(status)` against a plain declaration, and one recreated partial against a plain declaration, each report exactly one `check-object-differs` — B1/B2 proved in the reverse direction live.

Gates: `pnpm check` (clean) · `pnpm check-types` (18/18) · `pnpm check:bans` (0 violations) · `pnpm build --force` · `pnpm test` (full monorepo) · `pnpm --filter hejbro test:integration` (16/16, Docker) · `openspec validate harden-check-expressions --strict` → valid.

Commits: `c583427d fix(cli): compare an index as an ordered key list` (1.9: catalog.ts keys field, expression.ts compareIndexKeys), `c777a348 test(cli): pin the collation blind spot explain's output drops` (follow-up measurement after 1.9's own commit), `d6ca00a5 fix(cli): every declared index reaches the key comparison` (1.10: filter removed, Docker witness, brownfield-adoption.md).

<a id="w3"></a>
## W3 — review round 2: include columns are not keys

_2026-09-04T20:21Z_

## Review round 2, B4: a covering index's INCLUDE columns are not keys

### Reproduction (measured, docker postgres:17-alpine)
- `create index i on t (a) include (b)`: `pg_index.indkey` lists both `a`
  and `b`, in that order; `pg_index.indnkeyatts` is `1` (only `a` is a
  real key).
- Declared `on(t.a)` against that database index, under the pre-fix
  `unnest(ix.indkey) with ordinality` (unbounded): catalog `keys` reads
  `[a, b]`, declared reads `[a]` -- reported "1 key(s) vs 2 key(s)",
  permanently, since hejbro's DSL has no way to declare `INCLUDE` and
  make the counts agree.
- Declared `on(t.a, t.b)` against the same database index: catalog
  `keys` reads `[a, b]`, declared reads `[a, b]` -- counts agree, and
  position 2 is plain on both sides, so `compareIndexKeys`'s own rule
  (a plain-plain position is not compared beyond existence) drops it --
  "no differences", though the database's second key is an `INCLUDE`
  column, not a real key the index orders by.

### Root cause
`pg_index.indkey` (an `int2vector`) is documented to list key columns
first, then `INCLUDE` columns -- `pg_index.indnkeyatts` gives the
boundary. The pre-fix query walked the whole vector unconditionally.

### Fix
`catalog.ts`: `where k.n <= ix.indnkeyatts` bounds the
`unnest(ix.indkey) with ordinality` walk to real keys only, so an
`INCLUDE` column never reaches `IndexRow.keys` at all -- excluded at the
catalog boundary, not filtered downstream. `compareIndexKeys` itself is
unchanged: it already had no notion of `INCLUDE`, and now never sees one.

### Delta and docs
`spec.md`: "An index is compared as an ordered key list" gains "A
database index's `INCLUDE` columns are not keys -- they carry no
ordering and cannot be declared -- so they are neither counted nor
compared", plus a new scenario pinning both directions (declared `a` vs
catalog `a` `include (b)` -> no difference; declared `a, b` vs the same
database index -> one `check-object-differs` on the count, one against
two). `design.md` records the `indnkeyatts` bound. The text-mode
coverage-boundary line ("index predicates and expression columns") is
corrected to "index predicates and keys", matching the ordered-key-list
model the boundary line has described since round 1.
`skills/hejbro/references/brownfield-adoption.md` states the `INCLUDE`
rule and drops its `.blackbox/778/` citation (a flight-recorder path is
not a user-facing reference).

### Verified
- Unit: `check-catalog.test.ts` pins `indnkeyatts` in the indexes query
  text; `check-expression.test.ts` 4.2 gains the two `compareIndexKeys`
  rows (agrees when INCLUDE excluded; differs one-against-two when a
  declared key is only ever the INCLUDE column);
  `check-command.test.ts` 1.6's boundary-line assertion updated.
- Docker live witness (`check-live.integration.test.ts`, new describe
  block): hejbro's own DSL cannot declare `INCLUDE`, so the covering
  column is added with `psql` directly onto a hejbro-generated index --
  declared `on(t.a)` against `(a) include (b)` exits 0 with no
  differences; declared `on(t.a, t.b)` against the same database index
  exits 1 with exactly one `check-object-differs` naming the index.

