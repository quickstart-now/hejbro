# DSL cheatsheet

Read this when writing or editing a schema declaration.

## Schema & table

`schema(name)` declares a namespace; `table(schema, name, columns, extras?)`
declares a table. Column keys are camelCase in TypeScript and render
snake_case in SQL.

Column order: the declaration order is used when the table is created; a
column added later lands at the **end** of the table in Postgres whatever
position it has in the object literal, and hejbro's snapshot and generated
SQL follow that physical order (reordering existing columns in TypeScript
changes nothing).

```ts
import { schema, table, uuid } from "hejbro";

export const app = schema("app");
export const posts = table(app, "posts", { id: uuid().primaryKey() });
```

See a full example: `examples/postgres/src/app.schema.ts`.

## Column types

Every column factory (`uuid()`, `text()`, `integer()`, `timestamptz()`, …)
and its chainable modifiers (`.notNull()`, `.primaryKey()`, `.unique()`,
`.default(...)`, `.defaultRandom()`, `.defaultNow()`,
`.generatedAlwaysAs(...)`, `.generatedAlwaysAsIdentity()`,
`.generatedByDefaultAsIdentity()`) are self-describing exports — see
`packages/core/src/types/column-builder-factories.ts`.

## Generated columns

```ts
import { bigint, integer, schema, sql, table } from "hejbro";

export const app = schema("app");
export const orders = table(app, "orders", {
  id: integer().generatedAlwaysAsIdentity(),
  amount: bigint().notNull(),
  doubled: bigint().generatedAlwaysAs(sql`amount * 2`),
  seq: bigint().generatedByDefaultAsIdentity(),
});
```

- Identity is for integer-family column types only, and `serial()` is not
  identity-eligible (its `nextval` default is the identity + default
  combination Postgres itself rejects). Both identity kinds imply
  `NOT NULL` — the column reads back non-nullable.
- ALWAYS-family columns (stored generated and always-identity) do not
  appear in any insert/update input type — the query chain's and core's
  raw builders' alike; a by-default
  identity can be supplied or omitted like any defaulted column. The
  database enforces the same rule at runtime (SQLSTATE `428C9`).
- Combining generated/identity with `.default(...)`, with each other, or
  with a non-eligible type fails loudly at declaration time.
- Converting an existing plain column to a generated one is not a silent
  rewrite: migration generation stops with `unsupported-column-alter` and
  a two-step remedy (drop the column, then re-add it as generated).
  Generated→plain emits `drop expression`; changing the expression
  rebuilds the column, which moves it to the end of the table.

## Foreign keys

A plain single-column foreign key is declared on the column:
`ownerId: uuid().notNull().references(() => users.id)` — one declaration
feeds both the generated DDL and the query layer's relation types. The
target must share the column's type family, and the thunk defers
evaluation (import-order safety). Self-referencing foreign keys,
composite (multi-column) ones, and `onDelete`/`onUpdate` actions are
declared in `extras.foreignKeys` instead; declaring the same column
through both paths fails at declaration time.

## CHECK constraints

`check(name, expr)` goes in a table's `extras.checks` array. The expression
is any boolean `Expr` — typed operators (`eq`, `gt`, `inArray`, `between`,
…) or a raw `sql\`...\`` template for things the operators don't cover
(e.g. a regex match). See `packages/core/src/dsl/check.ts` and the
status/slug CHECKs in `examples/postgres/src/app.schema.ts`.

## Indexes

`index("name").unique().using(method).on(asc(col), desc(col, { nulls: "last" }))`,
optionally partial via `.where(expr)`. An unnamed index derives its name
from the table and columns — except an expression index, which requires
an explicit name (see below).

`.using(method)` picks the access method: `btree` (default, never recorded
as a change), `hash`, `gin`, `gist`, `spgist`, `brin`, or pgvector's `hnsw`
/ `ivfflat` — any other name fails at declaration time with that list.
`unique` is B-tree only; combining it with another method also fails at
declaration time.

`op(column, "class")` attaches an operator class to one index column
(`jsonb_path_ops`, `gin_trgm_ops`, `vector_cosine_ops`, …) — validated as a
SQL identifier (D36), otherwise passed through to Postgres unverified.
`op(...)` composes with `asc`/`desc` in any order:
`op(desc(t.col, { nulls: "first" }), "c")`; `op` also wraps an expression,
not just a column: ``op(sql`lower(${t.email})`, "c")``.

`.on(...)` also accepts an expression (the same `sql` template CHECK and
partial predicates use) in place of a column — ``index("users_email_lower_idx").on(sql`lower(${t.email})`)``.
An expression index **must** carry an explicit name; the declaration-time
error proposes `<table>_<referenced columns>_idx`. The expression is
stored structurally (D67/D70), so `--rename` retargets a column used
inside it exactly like partial predicates already do.

See `packages/core/src/dsl/index-builder.ts`, the full guide at
`docs/guide/indexes.md`, the partial ordered index in
`examples/postgres/src/steps/step-3.schema.ts`, and the GIN / operator
class / expression indexes in `examples/postgres/src/app.schema.ts`.

## Foreign keys

`references: { columns: [t.id] }` — the referenced table is derived from
the columns' own refs, so `table` is optional and self-referencing FKs
need no extra syntax. `onDelete`/`onUpdate` are separate options. See
`packages/core/src/dsl/table.ts` (`resolveReferenceTarget`) and the
self-referencing `comments.parent_id` FK in
`examples/postgres/src/app.schema.ts`.

## RLS

`rls.policy(name).as("permissive" | "restrictive").for(command).to(...roles)`
then `.using(expr)` and/or `.withCheck(expr)` depending on the command.
Attach the built policies via a table's `extras.rls: rls.enabled({...})`.
`expr` is the same accepted shape as CHECK's — a typed operator
(`eq`, `isNotNull`, …) or a raw `sql\`...\`` template. For an
intentionally permissive policy ("allow every row"), use
`literal(true)` rather than a workaround like `isNotNull(someColumn)` —
it reads as the stated intent. See `packages/core/src/dsl/rls.ts` and
the reader/writer role-split policies in
`examples/postgres/src/app.schema.ts`.

## Grants

`grant(schema).usage.to(...roles)`, `.tables(...privileges).to(...roles)`,
`.defaultPrivileges.tables(...privileges).to(...roles)`. See
`packages/core/src/dsl/grant.ts`.

## Views

`defineView(schema, name, select(...), { securityInvoker? })` —
`securityInvoker` defaults to `false`; set it `true` for a view over an
RLS-protected table so the view runs under the querying role, not its
owner's. See `packages/core/src/dsl/define-view.ts`.

## Functions & triggers

`defineFunction`/`defineTrigger` signatures live in
`packages/core/src/dsl/define-function.ts` /
`packages/core/src/dsl/define-trigger.ts` — body-writing rules are their
own page: `function-builder-pitfalls.md`.
