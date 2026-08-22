# Quickstart: index access method, operator classes, expression indexes

```ts
import { schema, table, uuid, text, jsonb, timestamptz, index, op, desc, sql } from "hejbro";

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
both expression indexes' stored expression to the new column name — the
indexes are neither dropped nor re-created, only the `rename column`
statement is emitted.

What fails at declaration time (with a `Next:` line): `using("gim")`
(unknown method), `index().unique().using("gin")` (unique is B-tree only),
`op(t.x, "bad-class")` (not a SQL identifier), `index().on(sql\`lower(${t.email})\`)`
(expression without a name), an expression that references another table
or contains a subquery.

What hejbro leaves to Postgres: whether the operator class exists, whether
the extension behind `hnsw` / `ivfflat` / `gin_trgm_ops` is installed.
