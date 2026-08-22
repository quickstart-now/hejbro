# Data model: Index completeness (Phase 1)

Three layers, as everywhere in hejbro: **DSL value** (what `table()` receives)
→ **snapshot** (what is committed) → **SQL** (what is emitted from the
snapshot alone, D24). All names follow `.claude/rules/naming.md`: TypeScript
unions camelCase, serialized keys single words / kebab, SQL's own tokens
verbatim.

## DSL (`packages/core/src/dsl/index-builder.ts`, `dsl/table.ts`)

```ts
/** Postgres access methods hejbro accepts (D85, closed). */
export type IndexMethod =
	| "btree" | "hash" | "gin" | "gist" | "spgist" | "brin"   // built-in
	| "hnsw" | "ivfflat";                                      // pgvector

/** One entry of an index column list after wrapping. `column` is a column
 *  ref or any expression (sql``/operators); `opclass` is an identifier or null. */
export type IndexColumn = {
	readonly column: ColumnRef | Expr;
	readonly desc: boolean;
	readonly nulls: IndexNulls | null;
	readonly opclass: string | null;
};

/** What `.on(...)` accepts: a bare ref, a bare expression, or a wrapped entry. */
export type IndexColumnInput = ColumnRef | Expr | IndexColumn;

export const asc:  (input: IndexColumnInput, options?: { nulls?: IndexNulls }) => IndexColumn;
export const desc: (input: IndexColumnInput, options?: { nulls?: IndexNulls }) => IndexColumn;
export const op:   (input: IndexColumnInput, opclass: string) => IndexColumn;   // NEW

export type IndexBuilder = {
	unique(): IndexBuilder;
	using(method: IndexMethod): IndexBuilder;                                      // NEW
	on(...columns: ReadonlyArray<IndexColumnInput>): IndexDeclarationBuilder;
};

/** Declaration shape `table()` consumes (public; `@hejbro/supabase` reads it). */
export type IndexColumnDeclaration =
	& ({ readonly name: string } | { readonly expression: ExprNode })            // NEW variant
	& { readonly desc: boolean; readonly nulls: IndexNulls | null; readonly opclass: string | null }; // opclass NEW

export type IndexDeclaration = {
	readonly columns: ReadonlyArray<IndexColumnDeclaration>;
	readonly unique: boolean;
	readonly indexName: string | null;
	readonly predicate: ExprNode | null;
	readonly method: IndexMethod | null;                                          // NEW; null = btree
};
```

Normalization rules applied by the builder / `table()`:

| Input | Declaration |
|---|---|
| `using("btree")` | `method: null` (btree is never recorded — SC-004) |
| `t.col` | `{ name: "col", desc: false, nulls: null, opclass: null }` |
| `sql\`lower(${t.email})\`` | `{ expression: <sqlTemplate node>, desc: false, nulls: null, opclass: null }` |
| `op(desc(t.col, { nulls: "first" }), "c")` / `desc(op(t.col, "c"), { nulls: "first" })` | `{ name: "col", desc: true, nulls: "first", opclass: "c" }` |
| `unique && method ∉ {null}` | error `unique-index-method` at `.on()` |
| expression entry && `indexName === null` | error `index-expression-requires-name` at `table()` |

Validation order inside `table()` (existing block `table.ts:206-377`, extended):
`unknown-index-column` (name entries only) → duplicate names (name-only
derivation) → `index-expression-requires-name` → `index-expression-subquery`
→ `index-expression-foreign-column-ref` → existing predicate checks.

## Snapshot (`packages/core/src/kinds/table-snapshot.ts`, format **5**, D84)

```ts
export type IndexColumnSnapshot =
	& ({ readonly name: string } | { readonly expression: JsonValue })  // expression = encodeExprNode(...)
	& { readonly desc?: true; readonly nulls?: IndexNulls; readonly opclass?: string };

export type IndexSnapshot = {
	readonly name: string;
	readonly columns: ReadonlyArray<IndexColumnSnapshot>;
	readonly unique?: true;
	readonly where?: JsonValue;
	readonly method?: Exclude<IndexMethod, "btree">;                  // absent = btree
};
```

Compactness: `method`, `opclass`, `desc`, `nulls`, `unique`, `where` are
present only when non-default. A 0.1.1 snapshot is therefore a valid
0.1.x-next snapshot with identical bytes. New accessors: `indexMethod(index):
IndexMethod` (`"btree"` when absent), `indexColumnOpclass(column): string | null`,
`indexColumnExpression(column): string | null` (rendered SQL, like `indexWhere`),
`isExpressionIndexColumn(column)` type guard.

Example (`table-index-methods` golden, final snapshot, keys stable-sorted):

```json
{
  "columns": [{ "name": "data", "opclass": "jsonb_path_ops" }],
  "method": "gin",
  "name": "docs_data_idx"
}
```
```json
{
  "columns": [{ "expression": { "nodeKind": "sql-template", "chunks": [ … ] } }],
  "name": "users_email_lower_idx"
}
```

## SQL (`packages/core/src/kinds/table-kind-emit-sql.ts`)

```
create [unique ]index "<name>" on "<schema>"."<table>"[ using <method>] (
  <item>[, <item>…]
)[ where <predicate>];

<item> ::= ( "<column>" | (<expression>) ) [ <opclass>] [ desc] [ nulls first|last]
```

`drop index "<schema>"."<name>";` — unchanged. Any field change → drop +
create (unchanged).

## Rename model (`packages/core/src/engine/rename-plan.ts`)

Fields that reference a column, after this feature (was five):
`ColumnSnapshot.default`, `IndexSnapshot.where`, **`IndexColumnSnapshot.expression`**,
`CheckSnapshot.expression`, `PolicySnapshot.using` / `withCheck`, `ViewSnapshot.query`.

| Rename | Name entries | Expression entries | Index name |
|---|---|---|---|
| column `a → b` | `name` rewritten (`resolveRenamedColumns`) | node retargeted (`retargetField`) | re-derived only if `wasDerived` (name entries only) |
| table `t → u` | unchanged | node retargeted (table identity inside refs) | re-derived only if `wasDerived` |

## Public surface delta (`packages/core/src/index.ts`)

Added exports: `op`, `IndexMethod`, `IndexColumnDeclaration`, and the
`indexMethods` const array (the single source of the closed list, D85 —
`.using()`'s runtime guard reads it). Widened:
`IndexColumn`, `IndexColumnInput`, `IndexBuilder`, `IndexDeclaration`,
`IndexSnapshot`, `IndexColumnSnapshot`. Removed: none. Behaviour of every
existing call unchanged (B-tree default, same derived names, same SQL).
