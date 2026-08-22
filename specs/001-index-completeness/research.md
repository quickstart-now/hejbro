# Research: Index completeness (Phase 0)

Every "unknown" the spec left for planning, resolved against the code on
`phase10-index-completeness` (fact sheet 2026-08-22) and Postgres 17's
`CREATE INDEX` grammar. Each item: **Decision · Rationale · Alternatives**.

## R1 — Where the access method is declared

**Decision**: `index(name?).using(method)` on the pre-`.on()` builder
(`IndexBuilder`), chainable in any order with `.unique()`; `.on()` is the
terminal that knows both flags.
**Rationale**: `IndexBuilder` is the immutable pre-column stage
(`index-builder.ts:55-75`); method, like uniqueness, is an index-level
attribute, not a column attribute; Drizzle uses the same shape
(`.using(method, …cols)` merged into one call, but ours keeps `.on()` as the
single column entry point so `asc/desc/op` stay per-column).
**Alternatives**: `index(name, { using })` options bag (breaks the
builder's chain style used everywhere else); `.on(…).using()` after the
columns (then `.where()`/`.using()` order becomes a question and
`IndexDeclarationBuilder` grows two optional tails).

## R2 — Access-method set and its TypeScript shape

**Decision**: `IndexMethod = "btree" | "hash" | "gin" | "gist" | "spgist" |
"brin" | "hnsw" | "ivfflat"` (closed union, D85); `using()` also
runtime-checks the value (`unknown-index-method`) for untyped callers.
`btree` declared explicitly is **normalized to absent** in declaration
and snapshot (so `using("btree")` ≡ default, SC-004).
**Rationale**: D85; the literal union gives autocomplete; runtime check
mirrors `index(name)` → `assertSqlName` at builder time. Normalizing
`btree` keeps old snapshots byte-identical and avoids a spurious drop +
create when a user adds or removes an explicit `"btree"`.
**Alternatives**: record `"btree"` when written (then adding the word
produces a migration — noise, and breaks SC-004's spirit).

## R3 — `unique` with a non-B-tree method

**Decision**: `.on()` throws `unique-index-method` when `unique && method
!== btree`. Message: why (Postgres supports `unique` only on B-tree) + `Next:
drop .unique() or .using(...)`.
**Rationale**: both flags are known at `.on()`; failing there is "declaration
time" (Principle III) and needs no table context. Postgres: "Only B-tree
indexes can be declared unique" (CREATE INDEX docs).
**Alternatives**: validate in `table()` with the other index validations —
works too, but the error would carry the table name and nothing else the
builder doesn't already know; builder-time is earlier and simpler.

## R4 — Operator class: wrapper shape and composition

**Decision**: a new wrapper `op(input, opclass)` where `input` is a
`ColumnRef`, an expression (`Expr`), or an already-wrapped `IndexColumn`;
`asc()` / `desc()` widen the same way. All three return `IndexColumn`, so
`op(desc(t.x), "c")`, `desc(op(t.x, "c"))`, `op(sql\`lower(${t.e})\`, "c")`
all work. `opclass` is `assertSqlName(opclass, "operator class")`-validated
(D36 identifier rule; catalog existence is Postgres' job — #220
detect-not-prevent).
**Rationale**: matches the existing `asc`/`desc` wrapper style
(`index-builder.ts:19-33`); no opclass parameters (`opclass (param = v)`)
— nobody asked, YAGNI.
**Alternatives**: `.on(t.x, { opclass })` tuple/options per column (breaks
the "every column input is a value" uniformity and can't wrap expressions);
`.op()` method on a column-builder object (there is none — inputs are
plain values).

## R5 — Expression index columns: declaration shape

**Decision**: `IndexColumnInput = ColumnRef | Expr | IndexColumn`;
`IndexColumn.column: ColumnRef | Expr` (kept name `column` to avoid a
public rename); `toDeclarationColumn` maps a `ColumnRef` to
`{ name, … }` and any other `Expr` to `{ expression: ExprNode, … }`.
`IndexDeclaration["columns"][number]` becomes a two-variant union:
`IndexColumnDeclaration = ({ name: string } | { expression: ExprNode }) &
{ desc: boolean; nulls: IndexNulls | null; opclass: string | null }`.
**Rationale**: `toDeclarationColumn` (`index-builder.ts:35-42`) is the single
choke point where refs are flattened to names; the partial predicate
already stores an `ExprNode`, so expressions reuse the AST, `sql`
template, codec, validation and retargeting — Principle "no new
expression system" (D46).
**Consequence**: `@hejbro/supabase`'s `indexDescription`
(`rls-cached-auth-outside-rls.ts:58-67`) reads `.columns[].name` and must
handle the `expression` variant (render a short description). That is a
preset consuming core's **public** type — allowed; the change is additive
and compile-checked.
**Alternatives**: a separate `expressionIndex()` builder (two builders,
two validations, two snapshot paths — rejected); storing expressions as SQL
text (loses retargeting — contradicts D67/D70).

## R6 — Naming of expression indexes

**Decision**: D86 — `.on()` with any expression entry and `indexName ===
null` → `table()` throws `index-expression-requires-name`, message ends
with `Next: name it — index("<table>_<cols>_idx")` where `<cols>` are the
column refs collected from the expressions (`collectColumnRefs`), or
`<table>_expr_idx` when none. Thrown in `table()` (not the builder)
because the table name is part of the proposal.
**Rationale**: D86; the proposal reuses `deriveIndexName` so the suggested
name is the one the user would have gotten for the plain columns.
**Alternatives**: rejected in the clarification session.

## R7 — Validation of expression entries

**Decision**: extend the existing `validateIndexPredicates` pattern
(`table.ts:342-377`) to expression columns: `index-expression-subquery`
(`someExprNode(node, n => n.nodeKind === "exists")`) and
`index-expression-foreign-column-ref` (`collectColumnRefs` → first ref
whose schema/table differ). `unknown-index-column` (`table.ts:215-220`)
must iterate only `name` entries. Duplicate-name detection: expression
entries contribute nothing to derivation (they are always named per R6).
**Rationale**: identical semantics to partial predicates (Postgres forbids
subqueries in index expressions; only the table's own columns are visible).
**Alternatives**: none worth a row.

## R8 — Snapshot shape (no format bump, D84)

**Decision**: `IndexSnapshot.method?: IndexMethod` (absent = btree);
`IndexColumnSnapshot = ({ name: string } | { expression: JsonValue }) &
{ desc?: true; nulls?: IndexNulls; opclass?: string }`. Encoded via
`encodeExprNode` like `where`. Tokens: `method` values (`gin`, …) and
`opclass` values (`jsonb_path_ops`) are **SQL's own tokens stored verbatim**
— the deliberate exception `.claude/rules/naming.md` records for
`ComparisonNode.operator` / `OrderByTerm.direction`; keys are already
single words. `HEJBRO_SNAPSHOT_VERSION` stays 5.
**Rationale**: D84; compact-by-default keeps every existing golden
`snapshot.json` and every user snapshot byte-identical; `diffByKey`'s
`sameJson` equality picks the new fields up with no diff-code change
(`diff-helpers.ts:22-24`).
**Risk**: `naming-conventions.test.ts:382` polices that "*Kind field
values are kebab-case" — `jsonb_path_ops` has underscores. Column names
(`published_at`) already pass, so the test must already exempt
identifier-valued fields; if it does not, the test gains `method`/`opclass`
to its verbatim-token allowlist (same category as `operator`).
**Alternatives**: rejected in the clarification session (bump to 6).

## R9 — Emitted SQL

**Decision** (Postgres 17 grammar): `create [unique ]index "<name>" on
"<schema>"."<table>"[ using <method>] (<item>[, …])[ where <pred>];` with
`<item> = <"column" | (<expr>)>[ <opclass>][ desc][ nulls first|last]`.
`createIndexSql` gains a `usingClause(index)`; `indexColumnSql` gains the
expression branch (`(${renderExpr(decodeExprNode(expression))})`) and
the opclass token. `drop index` unchanged. Any change = drop + create
(unchanged path, `table-kind-emit.ts:476-483`).
**Rationale**: token order is Postgres': `( { column_name | ( expression ) }
[ COLLATE … ] [ opclass [ ( … ) ] ] [ ASC | DESC ] [ NULLS { FIRST | LAST } ] )`.
Expressions render with fully-qualified column refs
(`lower("app"."users"."email")`) exactly as partial predicates do today;
Postgres accepts qualified refs in index expressions and `pg_dump`
normalizes both paths the same way, so the two-path round-trip stays
byte-equal.
**Alternatives**: render expression refs unqualified (a second render mode
for one site — no).

## R10 — Rename retargeting

**Decision**: (a) `retargetTableFields` (`rename-plan.ts:877-903`) gains a
fourth field family: each index column's `expression` goes through
`retargetField`; `applyRetargetedIndexColumns` rebuilds the index.
(b) `rewriteIndexesForRename` (`:1058-1102`) maps `name` only for
`name` entries; for `wasDerived` it uses the `name` entries' names (an
expression index is always explicitly named, so `wasDerived` is false
unless the user picked the derived spelling — then the guard behaves as
today). (c) `rewriteExpressionReferences` / ambiguity detection's "fields
that reference a column" list (`:969-1004`) gains index-column
expressions as its sixth member so a rename that only touches an
expression index is recognised as a reference, not a drop + add.
**Rationale**: `retargetExprNode` is a mapped type over every node kind
(`retarget.ts:395-408`), so nothing new is needed at the node level — only
the plumbing that knows where index expressions live.
**Alternatives**: none.

## R11 — Golden, round-trip, example

**Decision**: new golden case `table-index-methods` (from-empty: GIN on
`jsonb` with `jsonb_path_ops`, BRIN on `timestamptz`, HASH on `uuid`,
expression `lower(email)` named, GIN `gin_trgm_ops` on text — SQL-only,
no extension needed to *render*; step-1: method change + opclass change +
expression change under the same names (drop + create); step-2: column
rename via `--rename` that lives inside the expression — the existing
`rename-plan.test.ts` covers the plumbing, golden covers the emitted
statement). `examples/postgres` gains one GIN `jsonb_path_ops` index on a
`jsonb` column and one `lower(email)` expression index in a new step 8 —
**built-in only** (no `pg_trgm`, no `vector`), so `postgres:17-alpine`
round-trips without an extension (`scripts/roundtrip.sh:10`). `hnsw` /
`ivfflat` / `gin_trgm_ops` are covered by unit + golden only (extension
creation is out of scope; a note in the guide).
**Rationale**: SC-002 requires a round-trip with a non-B-tree index and an
expression; the stock image has no pgvector; the catalog check is
name-only (`check-declared-vs-catalog.mjs:518-522`) so no change there.
**Alternatives**: add `create extension pg_trgm` to `seed/roles.sql` — a
stock contrib module, would work, but makes the example's prerequisites
wider than "a Postgres" for one opclass; skipped.

## R12 — Docs

**Decision**: new `docs/guide/indexes.md` (access method, opclass,
expressions, extension note, name rule); `skills/hejbro/references/dsl-cheatsheet.md`
`## Indexes` rewritten; README `examples/postgres` feature line; and the
stale `docs/guide/renames.md:92` paragraph (says rendered expression text
keeps old names — superseded by D67/D70 structured nodes) corrected in
the same PR since this feature extends exactly that retargeting.
**Rationale**: there is no index guide page today (fact sheet §9).

## R13 — Diagnostics gate

**Decision**: new codes (`unknown-index-method`, `unique-index-method`,
`index-expression-requires-name`, `index-expression-subquery`,
`index-expression-foreign-column-ref`, `invalid-sql-name` reused for
opclass) need no registry entry — `scripts/check-diagnostic-xref.mjs`
only verifies codes *cited inside* messages; none of the new messages
cite another code.

## R14 — Changeset and decision log

**Decision**: one `patch` changeset (D83) naming all three fixed packages;
decision-log rows D84, D85, D86 written into
`docs/specs/2026-08-19-hejbro-design.md` §3 in the same PR (the spec's
"Proposes" section is the draft text); roadmap frontier + pilot verdict.
