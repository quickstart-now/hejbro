# @hejbro/core

## 0.2.0-pre.1

### Patch Changes

- 333dae8: A table-bound expression's column reference — a CHECK constraint, a
  partial index predicate, an index expression, a generated column's
  expression, or a policy's `using`/`with check` — now renders
  `"table"."column"` instead of schema-qualified, including one inside a
  correlated `exists()` subquery. A platform that keeps a tenant-aware
  table under an internal schema name (Nile) rejects the schema-qualified
  form outright; the two-part form is accepted everywhere and keeps the
  table visible to a reviewer. A view body and a query-builder statement
  are unaffected.
- b02443a: `defineFunction` now refuses, with `invalid-sql-name`, an argument key
  whose derived SQL name isn't a valid hejbro SQL identifier — the same
  D36 rule a column key already enforces — instead of silently emitting an
  unquoted, invalid name into the generated DDL and function body. A
  literal `__proto__:` key in an `args` object literal, which replaces the
  object's prototype instead of declaring an argument, is refused
  separately with `args-prototype-key`, naming the computed-key form that
  does declare one. `ctx.return` no longer accepts a mutation whose chain
  never called `.returning()`: the pre-`.returning()` stage is excluded at
  the type level, and a caller that reaches `ctx.return` with the type
  bypassed now fails at declaration time with `return-expects-returning`
  instead of rendering a `return query …;` statement Postgres accepts at
  creation and rejects only when the function is called. `ctx.execute`
  keeps accepting a mutation at either stage through the new exported
  `ExecutableQuery` type (re-exported by `hejbro`).
- 17f5495: A whole-table projection in a select that also joins now renders its columns schema-qualified, the way the same select's object-projection form always has; a select with no join renders exactly the SQL it did before. `execute()` of a set operation built with the core builder's own combinators now reads back as the left branch's declared row shape instead of an untyped driver row.

## 0.2.0-pre.0

### Minor Changes

- 6b3cc7f: Selects aggregate and group. `count()`, `countWhere(expr)`, `min`, `max`,
  `sum` and `avg`, with `groupBy(...)` and `having(condition)` in SQL's own
  clause order — `having` exists only after `groupBy`, and
  `orderBy`/`limit`/`offset` still follow it.
  
  The result types match what arrives: `count` is a `bigint` (converted,
  not the text the driver hands back for `int8`), `min`/`max` keep their
  argument's own declared type, and `sum`/`avg` stay at the numeric
  family's widest honest type because Postgres promotes them by the
  argument's exact type. Window functions remain tracked in #416.
- 5aebe5c: Array ergonomics: declare non-null array elements with a constraint that backs the claim — `.array().notNullElements()` emits a `CHECK` named `<column>_no_null_elements` and narrows the element type from `T | null` to `T` on read and write — and narrow nullable-element arrays at runtime with the new `assertNoNulls`, which throws naming the first null index and never filters.
- 65936ca: Common table expressions: `withCte((w) => { ... })` (and `handle.with(...)`
  on a `db()` handle, the same callback) declares a `WITH` statement.
  `w.as(name, query, options?)` declares an entry and hands back a typed
  reference usable as a `from` source anywhere a table would go (never as a
  join target); an entry may reference an earlier entry, never a later one
  or itself. `w.asRecursive(name, anchor, (self) => recursiveTerm, options?)`
  declares a recursive entry — the anchor fixes the CTE's own row type
  (Postgres's own rule), and the recursive term is checked for
  union-compatibility with the anchor (the same rule `.union()` already
  applies between two branches: matching keys required, each key free to be
  computed differently on either side, e.g. a window function). The
  recursive branch's own combinator surface is narrowed to `union`/
  `unionAll` only, so the four measured postgres:17 rejections (whole-set
  `order by`/`limit`/`offset`, `intersect`/`except` as the combinator) are
  unrepresentable rather than merely guarded. `options?.materialized` is a
  tri-state hint rendering `MATERIALIZED`/`NOT MATERIALIZED`/neither, on
  either kind of entry. Views, column ordering, the rename engine, and the
  Supabase RLS validator all widen to see through a `WITH` wrapper to its
  real tables.
- 9963d04: Generated-family columns: declare stored computed columns with `.generatedAlwaysAs(...)` and identity columns with `.generatedAlwaysAsIdentity(options?)` / `.generatedByDefaultAsIdentity(options?)` (sequence options included) — emitted with the full Postgres grammar, diffed with precise identity alters, snapshot format version 7, and insert/update input types that exclude the columns Postgres itself refuses to write.
- 9f58667: Selects paginate and de-duplicate. `.offset(n)` chains after `limit` (or
  stands alone), `.distinct()` collapses duplicate rows, and
  `.distinctOn(...columns)` takes one row per group — the row the
  statement's `order by` puts first, Postgres's own semantics, first-class
  rather than pushed to the `sql` escape hatch. Row counts render inline,
  never as bind parameters, the rule `limit` already followed.
  
  **Snapshot format moves to 8**: a view body's select now records its
  `offset` and `distinct`, so an older build refuses a version-8 snapshot
  loudly instead of diffing a paginated view as if it had neither (#437).
- e530909: Column-level foreign keys: `.references(() => users.id)` declares the same foreign key the `extras` path does — one declaration feeds the DDL and the type layer (the query layer's relation derivation reads the edge). Self-referencing and composite foreign keys, and `onDelete`/`onUpdate` actions, stay on `extras`; declaring both over one column fails loudly. Snapshot format version bumps to 7: foreign keys are recorded in canonical, declaration-form-independent order (v6 was never released). The nested-read base layer lands too: `jsonArrayFrom(subselect)`/`jsonObjectFrom(subselect)` compile to visible correlated subqueries (`compile()` shows every cast), with `bigint`/`numeric` values text-cast so precision survives the JSON round trip. `@hejbro/pg` now also pins `bytea_output` to `'hex'` at session setup (alongside the existing `intervalstyle` pin), so nested `bytea` values arrive in one deterministic shape. The sugar layer lands with it: `.related({ comments: true, author: true })` derives the same correlated reads from declared foreign keys (reverse keys = schema-map names, forward = the FK column minus its `Id` tail), rows arrive fully revived (nested `bigint` stays `bigint`, datetimes arrive as `Date`, `date` at local midnight), and ambiguous or unknown keys fail to type-check and throw.
- 27d5554: Set operations land on the query surface: `.union()`, `.unionAll()`, `.intersect()`, `.intersectAll()`, `.except()`, and `.exceptAll()` combine selects (nesting composes) into one statement with whole-set `orderBy`/`limit` (rendered as output column names — Postgres's own set-op rule), fully visible through `compile()`. Branch row compatibility is enforced at the type level (mismatched keys fail to compile); results type as the left branch's keys with per-column unions and OR'd nullability, and rows convert per the left branch's declarations. A set-operation query is a valid view body: it round-trips structurally through the snapshot (no format-version change) and the view's columns resolve from the left branch.
- 31c7ffd: Window functions: `over(target, spec)` attaches a `partitionBy`/`orderBy`
  window specification to an existing aggregate (`count()`, `sum(x)`,
  `min(x)`, `max(x)`, `avg(x)`) or one of eleven new window-only
  constructors — `rowNumber`, `rank`, `denseRank`, `percentRank`,
  `cumeDist`, `ntile`, `lag`, `lead`, `firstValue`, `lastValue`, `nthValue`.
  A window-only call has no meaning on its own; it only type-checks once
  `over()` wraps it. `rowNumber`/`rank`/`denseRank` read back as `bigint`
  (Postgres's own `int8`), `percentRank`/`cumeDist`/`ntile` as `number`,
  and `lag`/`lead`/`firstValue`/`lastValue`/`nthValue` as their argument's
  own declared type. Windows render under Postgres's default frame — frame
  clauses stay out of scope (#416). `where`/`groupBy`/`having`, an
  aggregate's own argument, and every declaration site that stores an
  expression (a column default, a generated column, an index expression or
  predicate, a check constraint, an RLS policy) reject a window function
  with a build-time diagnostic instead of a raw driver error.
- e6c802c: D106 R3-B3: a foreign key can now carry an explicit `name`
  (`extras.foreignKeys`'s own optional field, validated per D36 the same
  way `index()`'s optional name already is) — `hejbro import`/`pull` set
  it automatically whenever a database's own foreign key name is
  expressible, so a database hejbro did not create (most often named
  `<table>_<column>_fkey`, Postgres's own default) keeps its real
  constraint name through `generate`/`check` instead of drifting
  permanently to hejbro's own derived `<table>_<columns>_fk`. A name
  identical to the derived one is never written, so a hejbro-created
  database's own starter files stay byte-identical. When the catalog's
  own name isn't a valid hejbro SQL identifier, the reading falls back
  to the derived name and the loss report names the approximation.
  
  `@hejbro/core` exports `deriveForeignKeyName` and `assertSqlName` (the
  same D36 rule this feature validates a foreign key's own name against)
  for callers that need the same derivation/validation rule this feature
  uses internally.
- 2146480: `@hejbro/core` exports `isSqlName` (the same D36 rule `assertSqlName`
  enforces, as a boolean query), so a caller that must decide whether a
  name is declarable has one rule to ask, not a second, hand-rolled copy
  of it. `import`/`pull` now use it to decide the same question `table()`
  itself already enforces: a column whose SQL name begins with an
  underscore (`_id`) round-trips through its own TypeScript key but is
  not a valid hejbro identifier, and used to abort the entire reading;
  it is now omitted and named in the loss report instead, like every
  other name a declaration cannot carry.
  
  `import`/`pull` no longer abort when a foreign key's own *target*
  table or schema has a name a declaration cannot carry: that one
  relation is left out and named in the loss report (its own name is
  still declared as a column), and the rest of the database is still
  read. A `UNIQUE` constraint on an omitted table is no longer announced
  as an approximation for an object the same report says was never
  inferred, and a database whose named schemas are all omitted for their
  own names now refuses with its own diagnostic -- naming the reason in
  the loss report first -- instead of the misleading "found no table,
  enum, or sequence to infer": that message is now reserved for schemas
  that genuinely hold nothing, never for one hejbro just couldn't name.
  Either way, nothing is written and the `--out` directory is never
  created.
  
  Two tables in the same schema that each carry a check constraint of
  the same name no longer swap expressions: `import`/`pull` used to
  attach the wrong table's own check condition to whichever table came
  second, so the starter file declared a check asserting against columns
  that table doesn't have -- DDL the source database itself refused.
  Each table's own check expression is now read correctly, regardless of
  what its check constraints happen to be named.
- aad5078: Fixes from an adversarial review of the day's nested-transaction and
  `hejbro baseline` merges (#445).
  
  A second nested transaction started on the same `tx` while the first is
  still in flight now fails fast with `concurrent-nested-transaction`,
  before any savepoint statement is sent — concurrent siblings used to
  interleave one `SAVEPOINT` sequence on a single connection, silently
  discarding one sibling's work or aborting the whole transaction
  depending on the interleaving. A `RELEASE` that fails after a swallowed
  statement error now attempts `ROLLBACK TO` and surfaces
  `savepoint-release-failed` advising rethrow over swallow, instead of a
  bare `query-execution-failed`. A synchronously throwing nested callback
  now rolls back like a rejected one, and a rolled-back savepoint is
  released too, so no savepoint outlives the nested transaction that
  created it on any exit path. `savepoint-rollback-failed`'s message no
  longer asserts a false outcome.
  
  `hejbro baseline` over declarations that load but export nothing now
  fails with `baseline-nothing-to-adopt` instead of reporting a false "no
  changes" success and writing nothing; `--rename`/`--confirm-drop` are
  dropped from its `--help` and refused pre-parse with
  `baseline-flag-not-applicable`, since a baseline diffs against an empty
  snapshot and has nothing to rename or drop. `parseBannerBaseline` joins
  `parseBannerHashes`/`parseBannerVersion` as a public parser for the
  `-- baseline:` banner marker, matching its own prefix only.
  
  `ctx.return()` inside a plpgsql function/trigger body now dispatches by
  brand before duck-typing, so a table with a column literally named
  `exprNode` no longer misroutes `ctx.return(ctx.new)` down the expression
  path.
- 32a8f11: A mutation chain that never calls `.returning()` now resolves to
  `ReadonlyArray<never>` instead of the table's row type. The runtime
  value was always an empty array (the statement carries no `returning`
  clause, and hejbro never adds one implicitly); the type now says so, so
  code that read rows off `await db.insert(t).values(row)` fails to
  compile where it previously compiled and read `undefined`. Call
  `.returning()` or `.returning({ … })` to get rows back. `.returning()`
  with no projection still resolves every declared column. The bare type
  names (`InsertFinal<T>`, `InsertChainFinal<T>`, `ReturningRow<T>`, and
  their update/delete counterparts) keep meaning every declared column;
  only the stage a chain sits at before `.returning()` carries the
  never-requested instantiation.
- dafb897: Pre-0.2.0 hardening of the query surface (the `harden-query-surface`
  change; the fixed group moves all six packages). A declared index's
  `.on(...)` column must now belong to the table declaring the index —
  a plain column reference resolved from another table's declaration
  fails with `foreign-column-ref`, naming the foreign column, instead of
  passing silently or misdiagnosing a same-named collision as unknown
  (#464). Core's own `union()`/`unionAll()`/`intersect()`/`intersectAll()`/
  `except()`/`exceptAll()` now type-check branch key-set compatibility
  the same way the query package's chain surface and a recursive term
  already did, refusing a mismatched key set at build time instead of
  compiling a statement the server would reject (#487). Two branches — or
  a recursive CTE's anchor and recursive term — whose projections list the
  same key SET in a different ORDER are now refused at build time too,
  naming both orders and the first disagreeing position: `keyof` has no
  key order, so this half of #487 was previously silent data corruption
  (the wrong column's values under the right column's name) rather than a
  build error. `orderBy` (a select's own, a window's `over(...)` spec, and
  a set operation's whole-set order) accepts `asc(column)`/`desc(column)`
  with an optional `nulls: "first" | "last"` placement, the same vocabulary
  a declared index's column order already used, closing the gap where a
  query previously had no way to spell an explicit nulls placement at all
  (#470); `OrderByTerm` gains an optional `nulls` field, additive-compact
  and format-version-neutral. `countWhere(expr)` is removed rather than
  renamed (#469): it read as a predicate filter but actually counted rows
  where the operand was non-null, the one invented name among the
  aggregate vocabulary, and a real `FILTER (WHERE ...)` construct is
  tracked as a follow-up rather than shipped under that name — `count()`
  now accepts an optional operand directly. The recursive-term compatibility
  requirement's own justification is corrected (the shipped text
  overclaimed both an aggregate and a window function are legal there;
  measured, the aggregate half is refused by Postgres) and its documented
  scope is narrowed with two measured divergences (#489, partially closed):
  nullability alone diverging between anchor and recursive term is
  deliberately still accepted, while a same-family declared-type divergence
  (e.g. `numeric` against `bigint`) remains a known, tracked gap rather than
  a claimed-closed one.
- 1aa05f2: Narrows left-join nullability (#307): an object-projection field and a
  `returning()` field now follow their declared nullability instead of
  always widening to `| null` — a projected `.notNull()` column types as
  non-null unless its own table was actually left-joined in the same
  statement, and `returning()` is always non-null-exact, since a mutation
  has no join grammar to leave uncertain. This is a type-narrowing change
  only: generated SQL, snapshots, and runtime behavior are unchanged, and
  existing code that already widened its own annotations (or never
  narrowed a field it could now narrow) keeps compiling — only code that
  asserted a now-provably-non-null field was still `| null` can break.
  
  Aggregates and window functions stay nullable regardless of any join
  (an empty aggregate or a partition boundary can still produce `null`).
  So do **object-projection** fields read in a position that cannot see
  the surrounding statement's joins — inside a nested read, a CTE body, a
  view body, or a hand-written `SelectResult`. Whole-table rows in those
  same positions are untouched: a `jsonArrayFrom(select(table))` element
  and a `related()` row carry declared nullability exactly as they always
  have.
- 71033ca: Nested transactions run on savepoints. The `tx` handle a transaction
  callback receives now carries its own `transaction()`: it brackets the
  nested callback with `SAVEPOINT` / `RELEASE SAVEPOINT`, rolls back to the
  savepoint on a throw and rethrows the error unchanged, all on the same
  connection. A rolled-back nested transaction leaves the enclosing one
  usable, so the outer callback can catch and carry on. Calling
  `transaction()` on the db handle from inside a callback still fails —
  that would take a second connection out of the pool — and its message now
  points at `tx.transaction(...)` (#313).
- 6345323: A plpgsql body can execute a statement for its side effect, a dropped
  statement builder is caught instead of silently disappearing, and a
  `defineFunction`'s scalar `returns` accepts a column builder.
  
  `ctx.execute(<select | insert | update | delete>)` records a statement in
  body order, rendered `perform <sql>;` for a select (plpgsql's own rule
  for a bare `SELECT`) and `<sql>;` for a mutation; a mutation ending in
  `.returning()` is refused (`execute-expects-no-returning`), since
  plpgsql's `perform`/bare form has no `into` clause to receive returned
  rows. A statement builder constructed inside a body and never passed to
  a consumer (`ctx.execute`, `ctx.return`, `ctx.row`/`ctx.rowOrNull`/
  `ctx.forEach`, `exists`/`notExists`/`jsonArrayFrom`/`jsonObjectFrom`, a
  set-operation combinator, or `defineView`) now fails the declaration
  with `statement-builder-unused` instead of silently generating a body
  missing that statement (#423, #426). `ctx.if`/`elseIf` also widen to
  accept the same `Condition` union a query-side `where(...)` already
  does, so a `sql` fragment reads as a body condition too.
  
  `defineFunction`'s `returns` accepts a column builder wherever it
  accepts a raw type node, matching what `args` already accepts (#433):
  `returns: varchar({ length: 10 })` keeps its length, an enum keeps its
  identity, and a `$type`-branded `jsonb` return keeps its brand, all the
  way through to `db.fn`'s own call result type. A declared numeric mode
  (`bigint({ mode: "number" })`) now reaches `db.fn`'s runtime conversion
  instead of always falling back to the type's own default. A `returns`
  builder carrying `.notNullElements()` is refused
  (`returns-not-null-elements-unsupported`): a returns clause derives no
  backing CHECK, so the flag would promise something nothing enforces.
- 232293e: Object projections keep their declared column types. `select({ total:
  posts.amount }, posts)` reads `total` as `bigint` rather than the
  family-wide `number | bigint | string`, a projected
  `jsonb().$type<T>()` column as `T` rather than `unknown`, and an array
  column as its declared element array — recovered from the column
  reference's own declaration link, so `returning({...})` improves with it.
  Fields still type as nullable: a left join can null any of them (#307).
- 67ebf69: Generic type surfaces for `defineFunction` and the mutation builders
  (#293, tasks 4.10/4.11-mutation): `FunctionDeclaration` now carries a
  second, defaulted `TArgs`/`TReturns` type parameter pair recording the
  declared `args` shape and `returns` target, and `InsertFinal`/
  `UpdateFinal`/`DeleteFinal` (and their `*Returnable`/`*Filterable`
  intermediates) now carry defaulted `TTable`/`TReturning` parameters
  tracking the target table and the `.returning(...)` projection through
  `insert`/`update`/`deleteFrom`'s whole chain. Both are additive,
  phantom-typed (an optional marker field that is never actually
  assigned, so it is simply absent from the runtime object — not merely
  hidden from enumeration) narrowing-only changes — every existing
  non-generic consumer
  (`function-kind.ts`, `define-trigger.ts`, `render-body.ts`) keeps
  compiling unchanged against the bare, defaulted type names, and no
  runtime shape, generated SQL, or snapshot changes. This lets
  `@hejbro/query`'s `Db.execute(...)` resolve the exact row shape for
  `insert(...)`/`update(...)`/`deleteFrom(...)` statements the same way
  it already does for `select(...)`.
- 4be9551: Column builder type surface for query-layer type inference (#293): a
  second, defaulted `TMeta` type parameter on `ColumnBuilder` carries the
  declared type name, `notNull`/default visibility, numeric width mode
  (`bigint({mode})`/`numeric({mode})`, mirroring Drizzle's surface), and
  a jsonb `$type<T>()` brand — narrowing only, never past the column's
  own base type — all additive, no change to generated SQL, snapshots,
  or existing declarations. `NumericMode`, `BigintConfig`, `BaseTsType`,
  and `IntervalValue` are now exported from `@hejbro/core`'s public
  surface — `BaseTsType` is the declared-type → TypeScript mapping
  `$type<T>()` constrains against, and `IntervalValue` is the structured
  value an `interval` column reads back as.
- d3c39bc: Query-vocabulary gaps for the query layer (#293): `leftJoin()` on the
  select builder (new `joinKind: "left"` — snapshot codec accepts it, the
  renderer emits `left join`) and `returning({ alias: expr })` object
  projections on insert/update/delete (no-arg `returning()` keeps the
  every-column explicit list; an empty projection throws
  `empty-returning`).
- 34afb30: `json`, `jsonb` and `bytea` columns take raw values. An insert or update
  accepts any JSON-serializable value for a json column and a `Uint8Array`
  for a bytea column — hejbro serializes and encodes them, and the declared
  type decides between a `json` and a `jsonb` cast, so a `json` column never
  acquires jsonb's key reordering. A `.$type<T>()` brand now narrows the
  write as well as the read: a branded column accepts its own `T` and
  nothing wider. `sql` still works everywhere, and arrays of these three
  element types remain `sql`-only (#425).

### Patch Changes

- 5f8b97f: Refuse an empty on-conflict target: `onConflictDoNothing()` with no
  columns (or `onConflictDoUpdate` with an empty `target`) now fails fast
  with `empty-conflict-target` instead of rendering `on conflict ()` —
  SQL Postgres rejects at parse time.
- 46b902c: `sql` fragments are accepted in every condition position. Select `where`,
  join `on`, update and delete `where`, `related()`'s `where`, and the
  `and`/`or`/`not` combinators now take the same
  `Expr<"boolean"> | Expr<"unknown">` union — exported as `Condition` —
  that `check()`, partial indexes and RLS policies have always taken, so a
  predicate the typed operators cannot express needs no cast to reach a
  query (#386).
- 28aec17: Refuse a scalar `ctx.return(<expr>)` whose type family can never convert to the declared `returns` family, at declaration time, with `scalar-return-family-mismatch`. The refusal table holds only pairs measured on Postgres 17 as failing for every value — a pair Postgres accepts for some values stays accepted, a `sql` fragment is never family-checked, and text/bytea returns accept every family.
- effda0a: `MutationRow` (the raw `insert()`/`update()` row type) no longer carries a key for a stored generated column or a `generated always as identity` column — matching the query layer's input types and the database's own refusal, so a write Postgres will certainly reject fails to compile instead of failing at runtime.
- 70e68cc: `generateMigration` now expands a raw `TableDeclaration` input exactly like a whole `Table`: its RLS block, policies, and serial sequences are emitted, and an `existingTable` declaration is rejected — previously the raw form silently dropped the first three and skipped the guard.
- 387a2cc: Fixes an adversarial-review defect cluster in `SelectNode` traversal
  (#444): a literal inside `groupBy`/`having`/`distinct on` now becomes a
  bind parameter instead of splicing into the SQL text; a foreign
  reference in one of those clauses throws `foreign-column-ref` instead
  of rendering wrong SQL; a rename now retargets those clauses in a
  stored view's query, closing a no-leftover-diff gap; a pre-`groupBy` v8
  snapshot decodes leniently instead of raw-`TypeError`ing; RLS
  declaration-time scope checks and `@hejbro/supabase`'s
  `rls-uncached-auth-call` validator now see `auth.uid()` inside those
  clauses too. `min`/`max` keep their argument's read type but not its
  `ColumnRef`-ness, so an aggregate stops type-checking where a
  declaration API requires a real column reference — a compile-time
  failure now, instead of a silent wrong value at apply time. A written
  `null` reaches a `json`/`jsonb` column as SQL NULL, not the JSON
  document `null`; the JSON document `null` stays reachable through the
  `sql` escape hatch. An aggregate cell (`count()`/`min`/`max`) inside a
  nested read now casts and revives losslessly past `2^53`, the same
  guarantee a direct column already had.
  
  This lands as `patch`, not `major`, even though the proposal calls the
  `min`/`max` change breaking: it is a type *narrowing* on an unreleased
  surface (code that compiled and failed wrong at apply time now fails to
  compile, the fix), and the `json`/`jsonb` null semantics ride on
  `write-json-and-bytea`, which has not shipped — no released contract
  moves, and `major` is not used before 1.0.
- ef00b1b: Four fixes (#677):
  
  - `hejbro verify`'s `chain-tip-mismatch` now names the migration file
    whose `snapshot:` hash is the chain tip and the snapshot path it
    disagrees with, instead of misreading the message's own quoted
    `"snapshot:"` substring as the identity (#632).
  - `synced-function-declared` (a synthesized function declaration reaching
    `generate`) is now specified and documented, mirroring the existing
    table guard (#658, function half) — the error text itself was already
    correct.
  - A column-level `.references(() => target.column)` thunk no longer runs
    during `table()` itself — it resolves on the declaration's first
    `foreignKeys` read instead, so two declaration files (or two tables in
    one file) that reference each other now load under either order,
    including a genuine circular import between two schema files. Previously
    this crashed with a TDZ error (same file) or "Cannot read properties of
    undefined" (cross-file), regardless of which side was declared first
    (#669).
  - `ctx.return` now accepts a mutation ending in a projected
    `.returning({...})`, exactly as it already accepted the bare
    `.returning()` form — the rendered `return query ...` carries exactly
    the projected `RETURNING` list (#634).
- 0f19390: Enum columns type as their declared values. `pgEnum` is now generic over
  its values, so `pgEnum(app, "post_status", ["draft", "published"]).
  column()` reads back as `"draft" | "published"` and accepts only those
  literals as a write — previously it typed as bare `string` in both
  directions, and an undeclared value compiled and failed at the database
  (#422).
- 7bbdc8b: Index declarations gain three capabilities they lacked: an access method (`index().using("gin" | "hash" | "gist" | "spgist" | "brin" | "hnsw" | "ivfflat")`, with `btree` the unchanged default), an operator class per column (`op(column, "jsonb_path_ops" | "gin_trgm_ops" | …)`, composable with `asc`/`desc`), and expression indexes (`.on(sql\`lower(${t.email})\`)`, requiring an explicit index name since there's no column to derive one from). Every invalid combination — an unknown method, `unique` on a non-B-tree method, an invalid operator-class identifier, an expression referencing another table or a subquery, an unnamed expression index — fails at declaration time with a message naming the fix. Expression columns are stored in the snapshot as structured nodes, so `--rename` retargets the identifiers inside them exactly like partial-index predicates and CHECK expressions already do. A 0.1.1 project that only uses B-tree indexes regenerates unchanged: the snapshot format stays 5, and the new fields are additive and absent by default.
- 7c472b7: Internal refactor, no observable behavior change: `packages/core/src/kind/emit-helpers.ts` gains `requireNext`/`requirePrevious`/`requireBoth`, absorbing 31 byte-identical `invalid-kind-change` guards across the ten built-in kinds (#472); `packages/core/src/expr/expr-children.ts` (internal, not exported) gives a single child-position registry for `ExprNode`, replacing four separate handler tables in `walk.ts`, `render-sql.ts`, and `retarget.ts` that restated the same positions (#473). Every guard's existing message text, style, and check order is preserved exactly, including the two combined-message and two opposite-order sites; every `ExprNode` walker's traversal order (window's `fn`/`partitionBy`/`orderBy` included) is unchanged.
- 221d650: relicense from MIT to the Apache License 2.0 (owner decision, #570): every published package now carries the Apache-2.0 text as `LICENSE`, a `NOTICE` file with the copyright line, and `"license": "Apache-2.0"` in its manifest. Versions already published under MIT stay MIT; this and later versions are Apache-2.0. No runtime behavior change.
- 9394b37: Internal: the rename planner (`engine/rename-plan.ts`, 2,129 lines) is decomposed into cohesive modules under `engine/rename/` — no behavior change, no API change; the module path and every export stay put.
- b2be9b9: Scalar-returning functions can be written, and the wrong return shape is
  refused at declaration time. `ctx.return(expr)` renders `return <expr>;`
  for a function declared with a scalar `returns` type; returning a query
  from one now fails with `scalar-return-expects-expression` instead of
  emitting `return query …`, which Postgres rejects at apply time. A scalar
  body that never returns fails with `scalar-return-missing` (#424).

## 0.1.1

### Patch Changes

- 2ff02b7: `hejbro restore --help` documents the `<n>` positional; `hejbro --help` keeps each command on one line; `restore`'s undo hint notes that restored files are staged.
- 66117ac: Fix: a function declared `returns: <table>` failed at call time (`structure of query does not match function result type`) — or silently returned values under the wrong column names when the swapped columns share a type — once a column had been added to that table in the middle of its TypeScript declaration in a later migration. Snapshot column order is now the table's physical order: existing columns keep their order, new columns are appended, a renamed column keeps its position — the rule Postgres applies. `select(table)` / `.returning()` lists in function bodies and view definitions follow it. No snapshot format change; unchanged declarations render unchanged. Known limitation: a snapshot that already diverged from the database on 0.1.0 (a mid-declaration insert generated before this fix) is not repaired — hejbro has no database access by design; regenerate that table's functions by hand once, or drop and re-add the column.
- 1ebb306: `defineFunction` now takes the declared schema object as its first argument, like `table`/`defineView`/`grant` (#269) --
  `defineFunction(app, "archive_project", …)` instead of `defineFunction("app", "archive_project", …)`. The string form is still accepted on the 0.1.x line for compatibility (deprecated in JSDoc) and will be removed in 0.2.0.

## 0.1.0

### Minor Changes

- 2e125e8: Add Changesets-based release tooling: `.changeset/config.json` (a fixed
  version group across the three published packages, public npm access,
  `dev` as the base branch), root `changeset`/`version-packages`/`release`
  scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
  Introducing the release infrastructure itself is not a patch.
- e131220: `@hejbro/supabase` adds `authUidCached()`/`authJwtCached()` (#97) --
  the initPlan-cached form of `authUid()`/`authJwt()`, for use in RLS
  `using`/`withCheck` clauses (they render `(select auth.uid())`/
  `(select auth.jwt())`, which Postgres evaluates once per statement
  instead of once per row). `authUid()`/`authJwt()` are unchanged and
  remain the correct form inside a column `default`/`check` expression,
  where a scalar subquery is illegal.
  
  A new validator, `rls-uncached-auth-call` (part of
  `supabaseValidators`), warns when a policy calls the plain form where
  the cached one belongs. It does not look at column `default`/`check`
  expressions at all.
- 1b9d4fa: Every migration generated from now on records the hejbro version that
  wrote it: a `-- hejbro: <version>` line directly below `-- hejbro
  migration` (#229). `@hejbro/core`'s `renderBanner` takes the version as
  an optional third argument (`undefined` by default, so every existing
  call site and golden fixture is unaffected) and `parseBannerVersion`
  reads it back; the CLI reads its own `package.json` at runtime to supply
  the string, so core never touches the filesystem or knows its own
  version. Pre-#229 migration files (no version line) keep parsing
  unchanged.
- 58dcafa: The Supabase storage bucket kind's `alter` change now reports which
  fields actually changed (`"public changed"`, `"file size limit
  changed"`, `"allowed mime types changed"`) instead of an empty `notes:
  []`. Previously every bucket config change rendered a bare `-- ~
  supabase-storage-bucket <name> []` in the migration banner -- the only
  kind that emitted an empty notes list on an alter (#116).
- d5151ad: `@hejbro/core` re-exports `decodeExprNode` from its public index, paired
  with the already-public `renderExpr` — tooling outside the package can
  now render a declared column's default expression back to SQL text the
  same way core itself does, without reimplementing the expression codec.
  No behavior change: this is purely a new public export exposing
  existing, already-tested internal logic.
  
  (This capability is exercised by `scripts/check-declared-vs-catalog.mjs`,
  a private, non-published tool — #218 — which is why the fixed group's
  other two packages carry no code changes of their own here beyond the
  version bump their `.changeset/config.json` fixed grouping requires.)
- 51d4c20: `@hejbro/core` exports `someDeepExprNode`, a deep expression walker that
  descends into `exists(...)` subqueries (#141). `@hejbro/supabase` adds
  the `rls-cached-auth-outside-rls` validator, built on it: it errors
  when a column `default`, a CHECK, or a partial-index predicate calls
  `authUidCached()`/`authJwtCached()` — both render a scalar subquery,
  which Postgres forbids outside RLS.
- f27cbea: `hejbro` now records a table's primary key constraint name
  (`TableSnapshot.primaryKeyName`) and every unique column's constraint
  name (`ColumnSnapshot.uniqueName`) in the snapshot, matching Postgres's
  own naming convention exactly (`<table>_pkey`, `<table>_<column>_key`)
  — frozen now, pre-1.0, so a later feature never has to disagree with a
  name already committed to a user's database (#24/D68).
  
  `generateMigration` diffs a primary key as one table-level constraint
  (the set of `.primaryKey()` columns), replacing #137's silent gaps —
  adding a primary-key column to an existing table, and a composite
  primary key's partial drop — with real `add constraint`/`drop
  constraint ... primary key` emission. A column's own `.primaryKey()`
  flag flipping in place is folded into the same rule.
  
  `hejbro verify`/rename plans keep both names in step with a table or
  column rename (mirrors the existing index/foreign-key drift guard).
  
  UNIQUE constraint *emission* stays out of scope this wave — a changed
  `.unique()` flag still throws `unsupported-column-alter`, now with a
  reason (table-level, not expressible as a column alter).
- fb76507: Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
  `@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
  `test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
  now — no CI gate yet. `package.json` (a `devDependencies` entry and a
  new script) does change in all three published packages; `package.json`
  is always packed regardless of `files`, so D59's changeset rule applies
  literally here, not by analogy to a prior PR's precedent.
- 77120e7: `HejbroError` is now a real `Error` subclass instead of a plain object
  type. `code`, `message`, and `declaredAt` remain accessible the same way,
  but the CLI's `catch`-clause discriminator now checks `instanceof
  HejbroError` instead of duck-typing on "has a `code` and a `message`" —
  the old check misidentified any Node runtime error carrying a `.code`
  (e.g. `ERR_MODULE_NOT_FOUND`) as a HejbroError (#125). A plain object
  literal shaped like `{ code, message, declaredAt }` no longer satisfies
  the `HejbroError` type; build `HejbroError`s via the `hejbroError`
  factory instead — this can break consumer code that constructed one by
  hand rather than through the factory, hence `minor`, not `patch`.
- 67b9670: Column defaults, CHECK expressions, partial index `where` predicates,
  and policy `using`/`withCheck` clauses are now stored in the snapshot
  as structured expression nodes (D67/D70) instead of pre-rendered SQL
  text. This is what lets a table or column rename retarget the
  identifiers inside these expressions exactly — including across
  tables, when a policy reaches another table through `exists()` —
  instead of leaving stale text behind. Rendered SQL output is
  unaffected: the same `renderExpr` produces the same text at emit
  time, now from a decoded node instead of a stored string.
  
  **No format-version bump.** `v5` was opened by #152 for this change
  (D68); a snapshot generated in the intermediate `dev` state between
  #152 and #153 is not supported — no published version ever produced
  such a snapshot. A committed snapshot containing any of these four
  fields as pre-rendered SQL text (the only shape any published version
  of `v5`, or any earlier format version, ever wrote) will fail with
  `error[malformed-snapshot-node]` when read by `hejbro generate` —
  confirmed by reading a real snapshot from immediately before this
  change. hejbro makes no snapshot-compatibility promise before 1.0
  (pre-publication, no migration path — see AGENTS.md/D65); this is the
  kind of churn that policy exists to allow while it's still free.
- 8b22258: `hejbro` now keeps a schema-wide `grant(schema).tables(...)` (one-shot
  `all-tables-privileges`) in step with tables added by a later migration
  (#121). Postgres's own `grant ... on all tables in schema ...` only ever
  covers the tables that exist when it runs — a table declared after that
  grant already existed silently ended up ungranted, a chain-vs-fresh
  asymmetry the local round-trip caught but golden tests can't (they never
  run real SQL). `hejbro generate` now re-issues the exact schema-wide
  statement right after `create table` for every standing
  `all-tables-privileges` grant already covering the new table's schema.
  
  Extension interface change (D78): `ObjectKind.emit` gains a third,
  optional, read-only parameter — the full snapshot the diff is generating
  *toward*. `siblingChanges` (D74) can't cover this case: it's the diff's
  own change list, and a standing grant unaffected by the new table never
  appears there. Additive and backward compatible — every existing `emit`
  implementation (10 across `@hejbro/core` and `@hejbro/supabase`) ignores
  it and needs no change; only `tableKind`'s `create` case reads it.
- aedffb6: Adds two new CLI commands (#130): `hejbro history` lists every migration
  with its commit, date, state (`ok`/`lost`/`rewritten`/`uncommitted`),
  recorded snapshot hash, and subject line, computed purely from git
  plumbing against `migrationsDir` — `--links`/`--no-links` add
  GitHub/GitLab URL columns (or OSC8 terminal hyperlinks) for the origin
  remote. `hejbro restore <n>` restores declaration files matching
  `config.entry`'s glob back to migration `<n>`'s recorded state, guarding
  against a dirty working tree, an out-of-range target, and a
  lost/rewritten history state, then verifying the restored declarations
  reload, their format version pre-checks, and re-serializing them
  reproduces migration `<n>`'s recorded snapshot hash — reporting a
  colorized file-diff and the exact `git`/`rm` commands to undo it.
  
  Both commands are read/git-only: `@hejbro/core` is unchanged, and
  `packages/cli/src/git.ts` is the only module that spawns git
  subprocesses.
- 84670f9: Every user-facing `HejbroError` now pairs its "why" with a "Next:"
  clause stating a concrete, executable action (spec §7) — 59 call sites
  across `@hejbro/core` and `@hejbro/supabase` gained one, either by
  adding the literal `Next:` marker to guidance that was already there or
  by authoring new guidance. Internal-invariant guards (unreachable by
  any user action, confirmed by direct reproduction for the two
  ambiguous cases) are left as-is. A new `scripts/check-next-marker.mjs`
  (wired into `pnpm check:next-marker` and CI) keeps this a checked
  invariant going forward instead of a one-time sweep.
- 7391c48: New warning, `rls-unreachable-schema` (#203): fires when a policy's
  schema grants `usage` to none of the roles it targets. Postgres checks
  schema `usage` before RLS is even consulted, so such a policy can
  never run at all — the failure is `permission denied for schema`, not
  an RLS denial.
- c9b8852: `registry.register()` now requires a namespace prefix (a hyphen) from
  every kind id it doesn't already own itself -- previously this was
  only advice inside `duplicate-kind`'s message, surfaced solely once
  two kind ids actually collided. A preset registering an unprefixed
  kind id now fails immediately with `preset-kind-needs-prefix` instead
  of silently succeeding until a future collision. `@hejbro/supabase`'s
  own kind (`supabase-storage-bucket`) already satisfies this and needs
  no change.
  
  This is a new registration-time check a preset could start failing
  under, hence `minor` rather than `patch`. It buys predictable preset
  kind ids and an earlier, clearer error -- it does not make
  `unknown-kind`'s classification sound (see #196/#199): the reverse
  direction, "a core kind id never carries a hyphen," can't be enforced
  the same way, so `unknown-kind` still states both possible causes
  rather than guessing from a kind id's shape.
- fe5c20c: `ObjectKind` gains an optional `requiredKeys?: ReadonlyArray<string>` —
  every built-in core kind (and `@hejbro/supabase`'s storage-bucket kind)
  now declares its own snapshot node's mandatory top-level keys.
  `parseSnapshot` takes an optional second argument, a plain
  `ReadonlyMap<string, ReadonlyArray<string>>` built by the new
  `requiredKeysByKind(registry)` helper — when given, a hand-edited or
  corrupted snapshot entry missing one of its own kind's required keys is
  now reported by kind and key name at parse time, before the diff engine
  crashes on the `undefined` field downstream instead. Omitting the second
  argument (every pre-#159 call site) keeps `parseSnapshot`'s prior
  behavior unchanged. Follow-up to #26/PR #152's deferred "option 3".
- adcb680: `rls.policy(...).using(...)`/`.withCheck(...)` now accept
  `Expr<"boolean"> | Expr<"unknown">` — the same union `check()` (D50) and
  partial-index `.where()` (D51) already adopted, so a raw `sql` template
  (e.g. `` sql`${t.status} <> 'done'` ``) can be used directly as a policy
  predicate. Adds a `literal(value: boolean)` helper so an intentionally
  permissive "allow every row" policy can be written as
  `.using(literal(true))` instead of a borrowed-meaning workaround like
  `isNotNull(someNotNullColumn)`.
- 1206fd5: A policy `using`/`withCheck` expression that references a table outside
  its own schema/table — including one buried inside a correlated
  `exists()` subquery, referencing neither the subquery's own `from`/joins
  nor the outer policy's table — is now rejected at **declaration time**
  (`rls-policy-foreign-column`), the same moment every other policy
  validation runs. Previously this specific shape (a foreign reference
  *inside* `exists()`) only surfaced later, at `hejbro generate` time
  (`foreign-column-ref`), as a side effect of rendering the policy's SQL
  (#160).
  
  Fixing this closed a gap, not a new rule: a *direct* out-of-table
  reference (not inside `exists()`) was already rejected at declaration
  time before this change. If your declarations pass today, this changes
  nothing for you — a policy an earlier `hejbro generate` already accepted
  was already valid under the old, narrower check too.
- 626c57f: `serial`/`smallserial`/`bigserial` columns are now modelled properly
  instead of passed through as an opaque type name (#23/D66). A new
  `sequence` object kind tracks the backing sequence explicitly — the
  `create sequence`, `alter sequence … owned by …`, and
  `alter table … set default nextval(…)` statements `pg_dump` itself
  produces for a native `serial` column (confirmed by direct comparison
  against a real Postgres: structurally identical, modulo the `::regclass`
  cast Postgres adds on its own read-back and the role-ownership statement
  hejbro deliberately skips, consistent with its role-agnostic stance
  elsewhere).
  
  **This closes five real defects, not a cosmetic change**:
  
  - `integer()` → `serial()` used to render `alter column … type serial;`,
    which Postgres rejects outright — `serial` is `create table`/
    `add column` sugar, never a real, storable column type. Closed
    structurally, not by a runtime guard: a `ColumnSnapshot` never stores a
    `serial`-family type past `serialize` time (it always decomposes to
    the real base type — `integer`/`smallint`/`bigint`), so the invalid
    path is unreachable from the generic type-alter path rather than
    merely rejected by one.
  - `serial()` → `integer()` used to silently omit both the `drop default`
    and the sequence drop, since hejbro never tracked that the column had
    a `nextval(…)` default in the first place.
  - A table or column rename left the sequence's name behind — Postgres
    does **not** rename a serial-owned sequence on its own (confirmed
    directly against a real Postgres, not assumed) — the same drift the
    existing index/foreign-key name guards already close for those two
    kinds; sequences get the matching guard.
  - Dropping a table or column with a serial-family column double-dropped
    the backing sequence: Postgres's own `owned by` link already cascades
    the sequence away, but the `sequence` kind's own `drop default`/
    `drop sequence` statements used to run afterward, against a target the
    cascade already removed. Fixed structurally: both statements now go
    out on the `predrop` stage, which always runs before every kind's
    `main`-stage statements (the same stage `policyKind`/`triggerKind`
    already use for their own drops, for the identical reason) — so they
    always clear *before* the cascade could possibly race them.
  - Adding a `serial`-family column to a table that **already has rows**
    used to fail outright: `add column … not null;` and a separate
    `set default nextval(…)` cannot work as two statements, because
    Postgres only backfills a `not null` column from a default present in
    the *same* `add column` statement (confirmed directly against a real
    Postgres). `ObjectKind.emit` now receives the diff's sibling changes
    (`siblingChanges`, D74) so the `table` kind can inline a serial
    column's default into its own `add column` statement when the owning
    sequence is a sibling `create` change in the same diff — closing this
    for both new and existing tables alike.
  
  Also: `serial`/`smallserial`/`bigserial` always imply `notNull` on the
  column, independent of primary-key status (confirmed via `pg_dump`:
  neither `.primaryKey()` nor `.notNull()` is needed for Postgres to make
  the column not-null when it's serial-family) — a separate, narrower fix,
  landed as its own commit since it holds regardless of the sequence work
  above.
  
  No format-version bump. This is harmless right now because `formatVersion`
  5 has never been published (all three packages are `0.0.0`; #179 is the
  first release), so no reader exists to be broken — **but that is not the
  reason of record.** The reason is **D73 (#196)**: `formatVersion` tracks
  field *shape*, not vocabulary; adding a core kind never bumps it, before
  or after publication. An older hejbro reading a snapshot with a kind it
  doesn't know fails on the kind itself, not on the format — confirmed
  directly (a merge-base checkout of this repo, from before this PR,
  fed a hand-built v5 snapshot with a `sequence` node: `parseSnapshot`
  succeeds, `generateMigration` throws `unknown-kind`) — and #196's
  `unknown-kind` diagnostic is what tells that older hejbro to upgrade.
  Fixing that diagnostic's wording for a core (vs. preset) kind is out of
  scope for this PR — filed separately.
  
  No existing declaration used `serial`/`smallserial`/`bigserial` in the
  first place (confirmed:
  `grep -rnE '\b(serial|bigserial|smallserial)\b' packages/core/test/golden/cases examples --include="*.ts"`,
  scoped to every golden case and example other than this PR's own new
  `sequence-lifecycle` case, returns no matches — the plain-substring form
  `grep -rn "serial" ...` over the same scope returns two, both
  `serialize`/`.serialize(` false positives from an unrelated preset-smoke
  fixture, which is exactly why the word-boundary form is the one that
  answers this question), so there is also no *committed* snapshot this
  change affects either way.
- 75f2d0a: Snapshot format version bumped to `5` (D68). This PR only moves the
  version marker — no snapshot shape changed yet, so every existing
  declaration renders an identical snapshot object graph, just under
  `formatVersion: 5`. The actual shape changes this version opens the
  door for (structured expression nodes, primary key/unique constraint
  names) land in later PRs of the same wave without needing their own
  version bump. A snapshot written by a prior build (`formatVersion`
  4 or older) is rejected with the existing `unsupported-snapshot-version`
  diagnostic, same as any other format bump.
- 50ac657: `Table`'s and a trigger's `new`/`old` row's hidden metadata keys
  (`tableMeta`, `triggerRowMeta`) now use `Symbol.for` instead of
  `Symbol()`. Two installed copies of `@hejbro/core` (a real, if rare,
  package-manager outcome — e.g. a version-conflict-driven nested
  install) used to mint two different symbols sharing the same
  description, so `isTable`/`getTableMeta` — and, downstream, a foreign
  key's `references.table` cross-check (the shape `@hejbro/supabase`'s
  `authUsers` is used in) — could silently disagree about a table's
  identity across that boundary, up to and including a raw `TypeError`
  instead of a diagnostic. `Symbol.for`'s global registry makes the
  identity survive being installed twice.
- 92f075b: A view's own query is now stored in the snapshot as a **structured
  `SelectNode`** (`ViewSnapshot.query`, reusing #110/D67's expression
  codec) instead of pre-rendered SQL text (`ViewSnapshot.selectSql`, D27's
  original shape). This is what lets a table or column rename retarget the
  identifiers inside a view's query exactly, the same way #110 already
  does for column defaults, CHECK expressions, partial index `where`
  predicates, and policy `using`/`withCheck` clauses.
  
  **This is not a defect fix.** `create or replace view` already resolves
  a renamed dependency correctly today (Postgres re-resolves the view body
  against current names at replace time, not against the names in the
  stored definition text), and a *column* change to a view's own query is
  already a single `drop`+`create` pair (D27's prefix rule), never two
  independent add/drop halves a rename heuristic could misread. Nothing
  here was broken. It's done now anyway because pre-1.0 is the only free
  moment to change a snapshot's shape (D65): after publication, doing this
  later would mean a real format-version bump plus a migration story
  hejbro doesn't have yet, and it changes how an *unchanged* view
  declaration renders in the snapshot even though it changes no emitted
  SQL — D65's own trigger condition for "must happen before 0.1.0, not
  after."
  
  **No format-version bump.** `formatVersion` stays `5` — D68 already
  opened this pre-publication wave's single version for exactly this kind
  of change ("a change that alters how an unchanged declaration renders"),
  and this is the same wave, not a new one. **v5 carries the view field as
  well; D68's single pre-publication bump is unchanged.**
  
  Breaking shape change, no compatibility shim, consistent with hejbro's
  no-snapshot-compatibility-promise-before-1.0 policy (AGENTS.md/D65) —
  but milder than #110's own equivalent note for the other four fields:
  confirmed by direct reproduction (a scratch snapshot with a
  `selectSql`-shaped view, read by this change's built CLI, not just
  reasoned about) that `hejbro generate` does **not** throw. `emit` only
  ever reads the *current* declaration's freshly-serialized `query`, never
  decodes the *previous* snapshot's view field on a normal (non-`--rename`)
  run — the old `selectSql` value is only ever compared as raw JSON
  (`sameJson`), never decoded. Since a `selectSql`-shaped node and a
  `query`-shaped node are never byte-identical even when nothing about the
  declaration changed, every existing view gets exactly one spurious but
  harmless `~ view … [view changed]` migration on the first `generate`
  after upgrading — re-emitting `create or replace view` with byte-identical
  SQL to what already exists, not a crash and not a real change. A `--rename`
  run *does* decode the previous view's field (`rewriteExpressionReferences`),
  so an old-format snapshot combined with a rename touching a view still
  fails with `error[malformed-snapshot-node]`, same as #110's other four
  fields.

### Patch Changes

- 76e676e: Fix `hejbro verify`'s chain-linearity check (#129): a rollback that
  re-declares an earlier schema state was misclassified as
  `diverged-migrations` (a fork), because the old check grouped entries
  by parent value globally with no notion of position. `checkChain` now
  walks strict positional adjacency instead, so a rollback's own
  `current` returning to an earlier state satisfies the very next
  entry's `parent` immediately and never trips the fork check.
- 22e5766: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241's slice split. Ten
  `@hejbro/core` functions the ratchet-5 measurement found over the new
  threshold — `validateFormatVersion` (`snapshot/snapshot.ts`),
  `retargetColumnRef`/`retargetSelectNode` (`expr/retarget.ts`),
  `encodeLiteral`/`decodeLiteral`/`decodeProjection` (`expr/codec.ts`),
  `liftLiteral`/`renderLiteral` (`expr/literal.ts`), `recordReturn`
  (`plpgsql/body-context.ts`), `renderStatementLines`
  (`plpgsql/render-body.ts`) — are now built on a `.some()`/`.every()`
  over-an-array dispatch or a closed handler map instead of an `if`/`||`
  chain or a `switch`, mirroring the technique #154 PR2 and #241 already
  used elsewhere. Several (`encodeLiteral`, `decodeProjection`,
  `renderLiteral`, `renderStatementLines`) close a coverage gap no test
  could ever have closed the other way: their former `switch`'s `default:
  assertNever(...)` branch was structurally unreachable. The rest needed
  test coverage only, no code change (`decodeLiteral`'s malformed-input
  fallback, `liftLiteral`'s unsupported-JS-type fallback, `recordReturn`'s
  insert/delete-returning-query branches).
- ebea52a: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), closing out the `engine` +
  `kind/diff-helpers.ts` slice #249 started. `generateMigration`
  (`engine/generate.ts`, complexity 10 — the widest single split in this
  slice) splits into `resolveGenerateMigrationOptions`/`blockedResult`/
  `sortPredropStatements`, each answering one question the original
  function's own branches asked inline. Two functions that surfaced
  after #249 opened also clear: `validateRequiredKeys`
  (`snapshot/snapshot.ts`) splits out its own gap-detection question into
  `requiredKeyGapFor`; `findExprScopeViolation`'s `sqlTemplate` handler
  (`expr/walk.ts`) moves from an inline `if` inside a `.flatMap()`
  callback to a `.filter().map()` chain (previously untested — added a
  test using a `sql\`\`` template with an embedded foreign-column
  reference). `engine/duplicate-version-fix.ts`'s `orderGroupByChain`
  also gains a one-line comment naming why its root-count check exists,
  even though (like the `hasFork` check #249 already removed) it's
  subsumed by `walkGroup`'s own failure mode for the same inputs.
- 869376c: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242's slice
  split with the `engine` + `kind/diff-helpers.ts` slice. Twelve
  functions the ratchet-5 measurement found over the new threshold —
  `validateConfirmDropTarget`/`rewriteSequencesForRename`/
  `validateTableRenameTarget`/`validateColumnRenameTarget`/
  `residualTableAmbiguities`/`retargetTableFields`
  (`engine/rename-plan.ts`), `createOrDropDiff`
  (`kind/diff-helpers.ts`, shared by all 8 built-in kinds),
  `notNullWithoutDefaultWarnings` (`engine/core-validators.ts`),
  `resolveDeclarations` (`engine/generate.ts`), and
  `orderGroupByChain`/`parseVersionAsInstant`/`planDuplicateVersionFix`
  (`engine/duplicate-version-fix.ts`) — are now split into named helpers
  that each answer one question the original function's own branches
  asked inline, the same de-nesting/extraction technique #154 PR2 and
  #241/#242 already used. `orderGroupByChain` also drops a `hasFork`
  pre-check found to be fully redundant with checks already below it.
  Several needed test coverage only, no code change (a `--confirm-drop
  target: "table"` spec, the `"unix"` migration-prefix strategy, a
  single-member duplicate-version group).
- b2776c4: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154), continuing #241/#242/#249/#253's
  slice split with the `packages/core/src/kinds` slice (①-B). Five
  built-in kinds' `emit` the ratchet-5 measurement found over the new
  threshold — `rls-kind`, `sequence-kind`, `schema-kind`, `grant-kind`,
  `trigger-kind` — each move their `"create"`/`"alter"`/`"drop"` switch
  case into its own named module-scope handler, dispatched through a
  mapped `EmitHandlers` type over `ChangeOperation` (the object-literal
  handler-map technique #154 PR2/#241 already used) so a missing case is
  a compile error instead of a `switch`'s `default: assertNever(...)` at
  runtime — each handler is then scored as its own independent function.
  `sequence-kind`'s `diff` is also converted to reuse the shared
  `createOrDropDiff` guard, matching the other built-in kinds that
  already use it. No array-of-predicates tricks; every extraction is
  covered by a red-first mutation (swapped/inverted dispatch, confirmed
  to fail the existing golden tests) proving it's genuinely load-bearing.
- 2d0a2bd: Internal refactor, no behavior change: lowers CRAP scores ahead of the
  `CRAP_THRESHOLD = 5` ratchet (#154). The four `@hejbro/supabase`
  functions the ratchet-5 measurement found over the new threshold
  (`schemaOf`/`declaredAtOf` in `validators/schema-of.ts`,
  `childrenOfVariableArity` in `validators/rls-uncached-auth-call.ts`,
  `storageBucketKind.diff` in `storage/bucket-kind.ts`) are now built on
  `.some()`-over-an-array dispatch or a closed handler map instead of an
  `if`/`||` chain or a `switch`, mirroring the technique #154 PR2 already
  used across `@hejbro/core`. `@hejbro/core`'s `renderQuery`
  (`expr/render-sql.ts`) and `@hejbro/supabase`'s `storageBucketKind.emit`
  move from a `switch` with a structurally-unreachable `default:
  assertNever(...)` branch to the same handler-map technique, closing a
  coverage gap no test could ever have closed the other way. Six other
  functions (`retargetForeignKeyReferenceColumn`,
  `rewriteForeignKeysForRename`, `ambiguousTableRenameMessage` in
  `engine/rename-plan.ts`, `resolveEvent` in `dsl/define-trigger.ts`,
  `storageBucketKind.emit`'s invariant guard, `renderQuery`) needed test
  coverage only, no code change.
- b66c122: Internal readability refactor (#154 ratchet-5, no behavior change):
  `dsl/rls.ts`'s `assertClauseAllowed` and `dsl/table.ts`'s
  `resolveReferenceTarget`/`validateIndexPredicates` each split their
  independent rules/steps into their own named functions.
- fa49e8f: Internal readability refactor (#154 ratchet-5, no behavior change):
  `kinds/policy-kind.ts`'s `emit` now uses the established `dispatchEmit`
  handler-map pattern (`emitCreateChange`/`emitAlterChange`/`emitDropChange`)
  instead of an inline `switch`; `kinds/table-kind.ts`'s `diff` splits its
  four keyed-diff computation into `tableFieldDiffs`, and the emptiness/note
  checks that use them into `isEmptyTableFieldDiffs`/`tableFieldDiffNotes`;
  `kinds/table-kind-emit.ts`'s `sequenceForAddedColumn` splits its two
  compound conditions into `isMatchingSequenceCreate`/`sequenceOwnsColumn`.
- 836fa7b: Internal refactor, no behavior change: closes out #154's CRAP work
  (PR2/#210, PR3/#222) by splitting the three remaining violations that
  were never `switch`-over-closed-union walkers, so a handler map
  couldn't apply to them the way it did for PR2/PR3's conversions --
  `retargetProjection` (split by `projectionKind`, plus new test coverage
  for its previously-untested `"columns"` branch), `parseSnapshot` (split
  into five named validator steps), and the rename-target validator
  (split by table vs column target, plus a new table-target test for a
  previously-untested `unknown-rename-target` boundary). `pnpm check:crap`
  now reports zero violations across `@hejbro/core` and `@hejbro/supabase`.
- cdaa442: Internal refactor, no behavior change: lowers CRAP scores further (#154
  PR3, following PR2's #210). `renderTypeNode`'s 28-case `switch` over
  `TypeNode`'s `typeName` is now a type-closed handler map, same technique
  as PR2's `ExprNode` walkers. `view-kind.ts`, `function-kind.ts`,
  `enum-kind.ts`, and `table-kind-emit.ts`'s own `emit` — a
  `switch (change.operation) { "create" | "alter" | "drop" }` each opened
  with, deliberately left untouched by PR2 — now share one dispatch helper
  (`kind/emit-helpers.ts`'s `dispatchEmit`), with each operation's own body
  extracted into its own named function per kind.
- 02f5388: Internal: replaced ternary expressions with if/early-return helpers
  across `@hejbro/core` and `hejbro` (no behavior change), and added a
  CI check that cross-referenced diagnostic error codes actually exist.
- 908e2f5: README: install instructions and status reflect the published packages;
  stale phase framing removed.
- 63afd9c: `policy` and `trigger`'s `alter`/`drop` migration steps now emit a bare
  `drop policy`/`drop trigger` instead of `drop ... if exists` (D75) — an
  out-of-band removal of a policy or trigger hejbro still declares now
  fails loudly at the next `hejbro generate`/apply instead of silently
  being re-created. The `create` path is unchanged: a first-time create
  still emits the idempotent `if exists` guard, since there is no
  previous snapshot identity for drift to hide behind there. Matches
  `sequence`'s existing (#193) bare-drop behavior on the same two paths.
- 8261b88: `hejbro verify` gains a fifth check (#220): two migration files sharing
  the same version prefix are now a hard error, caught before the chain
  walk (chain order is undefined when versions collide) — Supabase
  applies migrations by this exact prefix, so a collision means one of
  them silently never runs. `Next:` gives a computed `mv` command per
  extra file rather than asking you to work it out. `diverged-migrations`'
  own `Next:` is rewritten the same way: one fully computed
  `rm ... && hejbro generate` option per candidate file, instead of prose.
- a8430ea: Test infrastructure: package tests resolve core from source; CLI
  subprocess tests check dist freshness (no runtime change).
- a854f21: Adding a `.primaryKey()` column to an existing table, or dropping a
  column out of a composite primary key while another column still
  declares `.primaryKey()`, now fails loudly with `unsupported-column-
  alter` instead of silently emitting incomplete SQL (#137).
  
  Both paths were real defects, not just missing features:
  
  - **Add path**: `renderColumnDefinition` (used for `add column`) never
    emitted a `primary key` clause -- that's a `create table`-only,
    table-level concern -- so `alter table … add column "x" uuid not
    null;` looked plausible while the constraint itself never appeared.
  - **Drop path**: dropping one column of a composite primary key drops
    the *entire* constraint on Postgres's side, with no warning
    (confirmed directly against a real Postgres) -- silently leaving any
    surviving `.primaryKey()` column without one, so a chain-built
    database and a fresh build of the same declaration disagree.
  
  This is a smaller, standalone fix -- `phase8-constraint-names` (#24)
  replaces this guard with the real `add constraint`/`drop constraint`
  emission for both paths. Landing the guard first means the silent
  corruption is closed even if `phase8-constraint-names` takes longer.
- aea1cf9: Internal refactor, no behavior change: lowers CRAP scores across
  several core walkers and kind-diff functions (#154). The create/drop/
  neither-exists guard every built-in `ObjectKind`'s own `diff` opened
  with (identical across all eight kind files that use it, differing
  only in the literal `kind` value, including `table-kind.ts`) is now
  one shared helper (`createOrDropDiff`, `packages/core/src/kind/
  diff-helpers.ts`). A new `familyOfTypeNode` lookup table replaces a
  type-family switch. `plpgsql`'s recording context now carries its
  state explicitly instead of through nested closures. Five other
  tree-walker switches (rename-retarget, the expression renderer,
  `codec.ts`'s encode/decode, a column-scope walker, and a general tree
  walker) are now type-closed handler maps instead of `switch`
  statements.
- 54c3394: The `unknown-kind` error no longer always suggests a missing preset,
  which was actively wrong for a snapshot written by a newer hejbro (a
  core kind this build predates, e.g. a future `sequence` kind, #23) --
  no preset could ever provide it, so the advice sent readers hunting
  for one that doesn't exist. The message now says so explicitly for any
  unrecognized kind id, alongside the original "check your presets"
  advice, since this build can't always tell the two causes apart
  (#196).
- 2cb855d: `hejbro verify --fix` (#220) automatically resolves a
  `duplicate-migration-version` collision it can actually order by chain
  history: it renames every "later" file in a resolvable group to a version
  after the directory's current latest (staggered a second apart for a
  3+-way collision), leaving migration content and the checked-in snapshot
  untouched, prints each `<before> -> <after>` rename, then continues into
  the normal five checks against the refreshed file listing.
  
  A group `--fix` can't safely reorder — a genuine fork (two migrations
  sharing the same parent snapshot), or a member with no readable
  hash-chain banner — is left untouched (`--fix` prints a `skipped: ...
  chain order undetermined, see Next` line for it, never silent), and
  `duplicate-migration-version`'s `Next:` offers one full `mv` option per
  group member instead ("assume this one is later; rename it; rerun
  verify") rather than a single confident guess, since hejbro genuinely
  doesn't know the order. Both the resolvable-group `(a) hejbro verify
  --fix` / `(b) mv ...` pick and the unresolvable-group per-member `mv`
  options are computed from the exact same chain-order check `--fix`
  itself runs, so the diagnostic text and what `--fix` actually does can
  never disagree.
