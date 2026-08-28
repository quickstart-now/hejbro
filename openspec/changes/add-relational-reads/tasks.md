# Tasks: add-relational-reads

Groups are parallel-safe slices (no file overlap). Group 3 starts
after groups 1–2 land (it consumes the node and the TMeta edge);
group 4 after 1–3. Estimates are pure work minutes (D88).

## 1. Column-level foreign keys (core declaration surface)

- [x] 1.1 (~8m) `.references(() => target.column)` builder: records
      the edge in `TMeta` (target table identity + column key) and on
      the column state. Red:
      `packages/core/test/column-builder.test.ts` — "references
      records the target edge at the type level and in the
      declaration". Files: `packages/core/src/types/column-builder.ts`,
      that test.
- [x] 1.2 (~8m) [design] `table()` folds column-level references into
      the same `ForeignKeyDeclaration` the extras path builds, and
      declaring both over one column fails loudly (error code and
      message settled here). Red: `packages/core/test/dsl.test.ts` —
      "a column-level reference produces the extras-equivalent foreign
      key; both forms over one column throw". Files:
      `packages/core/src/dsl/table.ts`, that test.
- [x] 1.3 (~6m) Same-DDL witness: identical create-table output and
      snapshot content for the two declaration forms. Red:
      `packages/core/test/table-kind-emit.test.ts` — "column-level and
      extras foreign keys emit identically". Files: that test only.

- [x] 1.4 (added at group 1 review — D1 owner ruling) Canonical
      foreign-key order: a table's foreign keys sort by a
      declaration-form-independent key (local columns, then target
      identity), so mixing or converting declaration forms is
      snapshot-invariant; snapshot `formatVersion` bumps 6→7 (v6 was
      never released — 0.1.1 shipped v5). Red:
      `packages/core/test/table-kind-emit.test.ts` — "a mixed-form
      table emits in the same canonical order as all-extras (D1)".
      Includes the golden/example/fixture v7 sweep.

## 2. Select-as-expression node and base helpers (core IR)

- [x] 2.1 (~10m) [design] New `ExprNode` variant embedding a
      `SelectNode` as a scalar expression with an aggregation mode
      (json array / json object), plus `jsonArrayFrom`/`jsonObjectFrom`
      wrapping the existing core select builder (node field names and
      kebab discriminators settled here — snapshot-reachable
      vocabulary, D57/D70). Red:
      `packages/core/test/query/select.test.ts` — "jsonArrayFrom wraps
      a subselect into a projection expression". Files:
      `packages/core/src/expr/ast.ts`,
      `packages/core/src/query/select.ts`, that test.
- [x] 2.2 (~10m) [design] Renderer: correlated emit —
      `coalesce((select json_agg(json_build_object(...)) ...),
      '[]'::json)` / single-object form, text casts on at-risk columns
      (bigint, string-mode numeric, datetimes, interval, bytea),
      reusing the outer-scope hook; exact SQL text settled here by
      golden. Red: `packages/core/test/expr/render-sql.test.ts` (or
      sibling) — "a nested projection renders the correlated aggregate
      with casts". Files: `packages/core/src/expr/render-sql.ts`, that
      test.
- [x] 2.3 (~8m) Codec round-trip for the new node (a view body can
      carry it, so it is declaration-reachable; vocabulary only, no
      formatVersion bump — D73). Red:
      `packages/core/test/expr/codec.test.ts` — "the
      select-as-expression node survives encode/decode/retarget".
      Files: `packages/core/src/expr/codec.ts`, that test.
- [x] 2.4 (~6m) A reference resolvable in neither the subselect's nor
      any enclosing scope keeps failing with the existing
      foreign-column diagnostic. Red: same render-sql test file —
      "an out-of-scope reference inside a subselect fails with
      foreign-column-ref". Files: that test only.

## 3. Query layer: nested types, related(), revive — after groups 1–2

- [ ] 3.1 (~10m) Nested result typing: a `jsonArrayFrom` key types
      `ReadonlyArray<Row>`, `jsonObjectFrom` types `Row | null`, and
      every nested column's type equals its top-level declared read
      type. Red: `packages/query/test/types/nested-read.test.ts` —
      "nested and top-level types agree column by column". Files:
      `packages/query/src/types/select-result.ts` (+ a new nested-read
      type module), that test.
- [ ] 3.2 (~10m) Relation-key derivation at the type level: reverse
      keys from the schema map, forward keys by the trailing-`Id`
      strip, collisions and unknown keys resolve to `never`. Red:
      same test file — "related keys derive exactly owner and
      comments; a misspelled key fails". Files: a new
      `packages/query/src/types/relations.ts`, that test.
- [ ] 3.3 (~8m) `related()` chain method: runtime derivation from the
      declared `ForeignKeyDeclaration`s producing exactly the explicit
      form's statements. Red: `packages/query/test/related.test.ts` —
      "related({...}).compile() equals the explicit
      jsonArrayFrom/jsonObjectFrom formulation". Files:
      `packages/query/src/db/chain.ts`, that test.
- [ ] 3.4 (~10m) Nested column plans and revive: the plan becomes a
      tree; `convertRow` parses the JSON cell and revives each nested
      value by declared type, recursing for grandchildren. Red:
      `packages/query/test/nested-revive.test.ts` (fake driver) — "a
      bigint past 2^53 revives intact from a nested payload". Files:
      `packages/query/src/db/convert.ts`, that test.
- [ ] 3.5 (~6m) Arrival shapes and the one-statement invariant: empty
      collection `[]`, missing forward row `null`, and a
      `db.as(ctx).select(...).related(...)` read compiles to exactly
      one statement. Red: same test file — "empty and missing arrivals;
      single compiled statement under a context". Files: that test
      only.

## 4. Real-server witness (pg integration) — after groups 1–3

- [ ] 4.1 (~10m) Docker PG17 witness: a parent+children+forward read
      via `related()` — nested values arrive revived (the 2^53 bigint
      witness), empty collection `[]`, missing forward `null`, and the
      RLS-context path executes it as one statement whose nested rows
      obey the context's policies. Red: extend
      `packages/pg/test/integration.test.ts`. Files: that file only.
