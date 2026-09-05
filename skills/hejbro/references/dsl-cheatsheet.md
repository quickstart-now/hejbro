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

## Enums

```ts
import { pgEnum, schema, table, uuid } from "hejbro";

const shop = schema("shop");
const articleStatus = pgEnum(shop, "article_status", ["draft", "published"]);

export const articles = table(shop, "articles", {
	id: uuid().primaryKey(),
	status: articleStatus.column().notNull(),
});
```

The declared values are the column's TypeScript type, both directions:
`status` reads back as `"draft" | "published"` and only those two
literals type-check as a write. Nothing to restate — no
`.$type<"draft" | "published">()` on top of the declaration (#422).

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

Two entry points declare a foreign key — both are legitimate, and
declaring the same column through both fails at declaration time:

| Use when | Form | Covers |
|---|---|---|
| A single local column, referencing one other table | Column-level `.references()` | Also feeds the query layer's relation types (`related()` — see the query-layer reference) in the same declaration; nothing is declared twice. An optional second argument carries `onDelete`/`onUpdate` |
| Composite (multi-column) or self-referencing | `extras.foreignKeys` | Everything the column-level form can't express |

**Column-level**: `ownerId: uuid().notNull().references(() => users.id)`
— one declaration feeds both the generated DDL and the query layer's
relation types. The target must share the column's type family, and the
thunk defers evaluation (import-order safety, #669): it never runs
inside `table()` itself, only on the declaration's first `foreignKeys`
read, so two declaration files (or two tables in one file) that
`.references()` each other resolve regardless of which one loads or is
declared first — including a genuine circular import between two schema
files. An optional second argument carries the foreign key's referential
actions: `ownerId: uuid().notNull().references(() => members.id, {
onDelete: "restrict", onUpdate: "cascade" })` — both `onDelete` and
`onUpdate` are optional, and each accepts one of `foreignKeyActions`'
five values (`cascade`, `restrict`, `set null`, `set default`,
`no action`). Self-referencing and composite (multi-column) foreign
keys still need the `extras.foreignKeys` form — declaring the same
column through both fails at declaration time
(`invalid-duplicate-foreign-key`: the constraint would emit twice), so
this is not "add extras alongside `.references()`", it is one form or
the other, per column.

**`extras.foreignKeys`**: an array of `{ columns, references: { table?,
columns }, name?, onDelete?, onUpdate? }` — `columns` names this table's
own local column(s); `references.table` is optional, derived from the
referenced columns' own refs when omitted, which is how a
self-referencing foreign key needs no extra syntax. `name` is optional
too (validated per D36 when given, same rule `index()`'s own optional
name already follows) and derives `<table>_<columns>_fk` when omitted;
give one explicitly to match a foreign key's own catalog name when it
was created outside hejbro (`hejbro import`/`pull` already do this for
you whenever the catalog name is expressible — D106 R3-B3):

```ts
import { schema, table, uuid } from "hejbro";

const app = schema("app");
const tasks = table(app, "tasks", { id: uuid().primaryKey() });

export const comments = table(
	app,
	"comments",
	{
		id: uuid().primaryKey(),
		taskId: uuid()
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		parentId: uuid(),
	},
	(t) => ({
		foreignKeys: [
			// Self-referencing (D52): `table` omitted, derived from the
			// referenced column's own ref. Stays on the extras path even
			// though it carries an action — self-referencing foreign keys
			// can't use the column-level form regardless.
			{
				columns: [t.parentId],
				references: { columns: [t.id] },
				onDelete: "cascade",
			},
		],
	}),
);
```

See `packages/core/src/dsl/table.ts` (`resolveReferenceTarget`,
`resolveForeignKeyName`) and the task/comment foreign keys in
`examples/postgres/src/app.schema.ts`.

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

A plain `.on(...)` column MUST belong to the table declaring the index —
`t.col` from the callback's own `t`, never a column resolved from a
different table's declaration. A foreign column fails declaration with a
`foreign-column-ref` error naming the foreign column's own schema, table,
and column, even when it shares its name with one of the declaring
table's own columns (which a name-only check could not tell apart).

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

A table-bound expression's column reference — a CHECK constraint, a
partial index predicate, an index expression, a generated column's
expression, or a policy's `using`/`with check` — renders `"table"."column"`,
not schema-qualified; a view body and a query-builder statement render
schema-qualified, as before.

## Functions & triggers

`defineFunction`/`defineTrigger` signatures live in
`packages/core/src/dsl/define-function.ts` /
`packages/core/src/dsl/define-trigger.ts` — body-writing rules are their
own page: `function-builder-pitfalls.md`.

`returns` accepts a column builder wherever it accepts a raw type node,
the same form `args` already takes — write `returns: varchar({ length:
10 })` instead of `returns: { typeName: "varchar", length: 10 }` when the
type carries detail (a length, an enum, a `$type` brand): the builder's
own type is what `db.fn`'s call result resolves through, so nothing it
carries is lost. A `notNullElements()` array can't be declared as a
`returns` type — a returns clause derives no backing CHECK the way a
table column does, so the flag would promise something nothing enforces.

```ts
import { defineFunction, schema, sql, table, uuid, varchar } from "hejbro";

const shop = schema("shop");
const orders = table(shop, "orders", { id: uuid().primaryKey() });

// returns: a raw type node still works ...
defineFunction(
	shop,
	"order_count",
	{ returns: { typeName: "bigint" } },
	(ctx) => {
		ctx.return(sql`(select count(${orders.id}) from "shop"."orders")`);
	},
);

// ... or a column builder, when the type needs its own detail.
defineFunction(
	shop,
	"order_status",
	{ returns: varchar({ length: 10 }) },
	(ctx) => {
		ctx.return(sql`'open'`);
	},
);
```
