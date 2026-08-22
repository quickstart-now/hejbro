# Indexes

`index("name")` (or unnamed, deriving a name from the table and columns)
builds an index declaration: `.unique()`, `.using(method)`, `.on(...columns)`,
optionally `.where(expr)` for a partial index. Columns can be wrapped in
`asc(...)` / `desc(...)` (with `{ nulls: "first" | "last" }`) and
`op(column, "class")` for an operator class, and an expression can stand in
place of a column reference. The wrappers compose in any order —
`op(desc(t.col, { nulls: "first" }), "c")` and `desc(op(t.col, "c"), { nulls: "first" })`
are the same declaration, and `op` wraps an expression just as well as a
column: ``op(sql`lower(${t.email})`, "c")``.

## Full example

```ts
import { schema, table, uuid, text, jsonb, timestamptz, index, op, desc, sql, isNull } from "hejbro";

const app = schema("app");

export const docs = table(app, "docs", {
	id: uuid().primaryKey().defaultRandom(),
	ownerId: uuid().notNull(),
	data: jsonb().notNull(),
	body: text(),
	createdAt: timestamptz().notNull().defaultNow(),
}, (t) => ({
	indexes: [
		// GIN for `@>` on jsonb, with the smaller jsonb_path_ops class
		index().using("gin").on(op(t.data, "jsonb_path_ops")),
		// BRIN for append-only time columns
		index().using("brin").on(t.createdAt),
		// hash for equality-only lookups
		index().using("hash").on(t.ownerId),
		// trigram search (needs the pg_trgm extension, enabled outside hejbro)
		index("docs_body_trgm_idx").using("gin").on(op(t.body, "gin_trgm_ops")),
	],
}));

export const users = table(app, "users", {
	id: uuid().primaryKey().defaultRandom(),
	email: text().notNull(),
	deletedAt: timestamptz(),
}, (t) => ({
	indexes: [
		// expression index — explicit name required
		index("users_email_lower_idx").on(sql`lower(${t.email})`),
		// unique + expression + partial compose
		index("users_email_lower_live_uidx").unique().on(sql`lower(${t.email})`).where(isNull(t.deletedAt)),
	],
}));
```

`hejbro generate` →

```sql
create index "docs_data_idx" on "app"."docs" using gin ("data" jsonb_path_ops);
create index "docs_created_at_idx" on "app"."docs" using brin ("created_at");
create index "docs_owner_id_idx" on "app"."docs" using hash ("owner_id");
create index "docs_body_trgm_idx" on "app"."docs" using gin ("body" gin_trgm_ops);
create index "users_email_lower_idx" on "app"."users" ((lower("app"."users"."email")));
create unique index "users_email_lower_live_uidx" on "app"."users" ((lower("app"."users"."email"))) where "app"."users"."deleted_at" is null;
```

Later, `hejbro generate --rename app.users.email=email_address` retargets
the expression stored for both indexes to the new column — no index DDL
is emitted, only `alter table … rename column`.

## Access method

`.using(method)` picks the index's access method — the closed list hejbro
accepts is `btree`, `hash`, `gin`, `gist`, `spgist`, `brin` (Postgres
built-ins) and `hnsw`, `ivfflat` (pgvector). `btree` is the default and is
never recorded as a change: an existing project whose indexes name no
method regenerates with zero migration output. Any other name fails at
declaration time with the accepted list.

```ts
index().using("gin").on(t.data);
```

```sql
create index "docs_data_idx" on "app"."docs" using gin ("data");
```

Postgres allows `unique` only on B-tree, so combining it with any other
method fails at declaration time:

```ts
index("docs_data_idx").unique().using("gin").on(t.data);
```

```
error[unique-index-method]: docs_data_idx
  index "docs_data_idx" is unique and uses "gin" — Postgres supports
  unique only on btree indexes. Next: drop .unique() or drop
  .using("gin").
```

Changing the method between two `generate` runs is a definition change like
any other: the migration drops the old index and creates the new one under
the same name.

## Operator class

`op(column, "class")` attaches an operator class to one index column —
`jsonb_path_ops` for a smaller/faster `@>` GIN index, `gin_trgm_ops` for
trigram search, `vector_cosine_ops` for pgvector's cosine distance, and so
on. hejbro validates the class name as a SQL identifier (`^[a-z][a-z0-9_]*$`,
D36) and passes it through to Postgres unverified — whether the class
actually exists (and whether its extension is installed) is checked by
Postgres at apply time, not by hejbro.

```ts
index().using("gin").on(op(t.data, "jsonb_path_ops"));
index("docs_body_trgm_idx").using("gin").on(op(t.body, "gin_trgm_ops"));
```

`op(...)` composes with `asc`/`desc` and nulls placement on the same
column; Postgres' own order is `<column or (expression)> [<opclass>]
[asc|desc] [nulls first|last]`, so `op(desc(t.col, { nulls: "first" }), "c")`
renders `"col" c desc nulls first`. `op` also wraps an expression, not just
a column — ``op(sql`lower(${t.email})`, "c")`` renders `(lower("app"."users"."email")) c`.

## Expression indexes

`.on(...)` also accepts an expression — the same `sql` template used
elsewhere (CHECK constraints, partial-index predicates) — for case-insensitive
lookups, a JSON path, a date truncation, or anything else that isn't a plain
column reference.

```ts
index("users_email_lower_idx").on(sql`lower(${t.email})`);
```

```sql
create index "users_email_lower_idx" on "app"."users" ((lower("app"."users"."email")));
```

The double parentheses follow Postgres' `index_elem` grammar for a column
list entry — a column, a function call, or a parenthesized `( a_expr )` —
which hejbro always renders as the `(a_expr)` form, uniformly, rather than
special-casing "is this a bare function call". `lower(...)` is itself
already parenthesized as a function call, so the `(a_expr)` wrap adds one
more pair around it; an operator expression like `"data" ->> 'status'`
needs the same wrap: `(("data" ->> 'status'))`.

**An expression index requires an explicit name.** There is no column to
derive one from, so ``index().on(sql`lower(${t.email})`)`` (unnamed) fails
at declaration time; the error's `Next:` line proposes
`<table>_<referenced columns>_idx` (`users_email_idx` for `lower(t.email)`,
or `<table>_expr_idx` when the expression references no column at all, e.g.
`` sql`now()` ``) — read it as a starting point, not a requirement to use it
verbatim.

The expression is stored in the snapshot as a structured node (D67/D70),
not rendered SQL text, so a `--rename` of a column used inside it retargets
the identifier exactly — the same mechanism partial-index predicates and
CHECK expressions already use (see [renames](renames.md)). An expression
that references another table's columns or contains a subquery fails at
declaration time, the same rule partial-index predicates already enforce.

```sql
alter table "app"."users" rename column "email" to "email_address";
```

The snapshot's expression is retargeted to
`lower("app"."users"."email_address")`; no index DDL is emitted — no drop,
no create, just the column rename above — and no ambiguity error.

## Extensions

`hnsw`, `ivfflat`, `gin_trgm_ops`, `vector_*_ops` and similar need their
extension (`vector`, `pg_trgm`, …) installed. Creating extensions is out of
scope for hejbro — enable them outside hejbro (`create extension …`, or your
platform's extension UI) before applying a migration that uses them. A
missing extension fails at apply time with Postgres' own message, not a
hejbro diagnostic.

## Changing an index

Any change to an index's method, operator class, expression, columns,
uniqueness or predicate is a drop + create of that index, like every other
index change today — Postgres has no `alter index … set method`. `hejbro
generate`, `verify`, `history --links` and `restore` all render method,
operator classes and expressions from the snapshot alone (D24); nothing
needs the original declaration to reproduce a past state.

A `--rename` that only retargets a column reference inside an expression is
not this case — see [Expression indexes](#expression-indexes) above: the
identifier changes but the expression's shape doesn't, so no index DDL is
emitted at all.

See `packages/core/src/dsl/index-builder.ts` and the GIN / expression
indexes in `examples/postgres/src/app.schema.ts`.

## Next

- [Renames](renames.md) — how `--rename` retargets a column used inside an
  index expression, and every other expression the snapshot stores
  structurally.
