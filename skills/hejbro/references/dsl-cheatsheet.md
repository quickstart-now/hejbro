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
export const app = schema("app");
export const posts = table(app, "posts", { id: uuid().primaryKey() });
```

See a full example: `examples/postgres/src/app.schema.ts`.

## Column types

Every column factory (`uuid()`, `text()`, `integer()`, `timestamptz()`, …)
and its chainable modifiers (`.notNull()`, `.primaryKey()`, `.unique()`,
`.default(...)`, `.defaultRandom()`, `.defaultNow()`) are self-describing
exports — see `packages/core/src/types/column-builder-factories.ts`.

## CHECK constraints

`check(name, expr)` goes in a table's `extras.checks` array. The expression
is any boolean `Expr` — typed operators (`eq`, `gt`, `inArray`, `between`,
…) or a raw `sql\`...\`` template for things the operators don't cover
(e.g. a regex match). See `packages/core/src/dsl/check.ts` and the
status/slug CHECKs in `examples/postgres/src/app.schema.ts`.

## Indexes

`index("name").unique().on(asc(col), desc(col, { nulls: "last" }))`,
optionally partial via `.where(expr)`. An unnamed index derives its name
from the table and columns. See `packages/core/src/dsl/index-builder.ts`
and the partial ordered index in
`examples/postgres/src/steps/step-3.schema.ts`.

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
