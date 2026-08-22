# Contract: emitted SQL

Golden case `packages/core/test/golden/cases/table-index-methods/` is the
executable form of this contract; the lines below are what its
`expected/*.sql` must contain (modulo banner and statement order rules).

## from-empty

```sql
create index "docs_data_idx" on "app"."docs" using gin ("data" jsonb_path_ops);
create index "docs_created_at_idx" on "app"."docs" using brin ("created_at");
create index "docs_owner_id_idx" on "app"."docs" using hash ("owner_id");
create index "docs_body_trgm_idx" on "app"."docs" using gin ("body" gin_trgm_ops);
create index "users_email_lower_idx" on "app"."users" (lower("app"."users"."email"));
create unique index "users_email_lower_uidx" on "app"."users" (lower("app"."users"."email")) where "app"."users"."deleted_at" is null;
```

Rules exercised: `using <method>` after the table name; B-tree never
rendered (`create index … on … (…)` as today); opclass after the column;
expression parenthesised, column refs fully qualified (same renderer as
partial predicates); unique + expression + partial compose; `desc` /
`nulls` follow the opclass (`("data" jsonb_path_ops desc nulls last)`).

## step-1 (same names, definition changed → drop + create)

```sql
drop index "app"."docs_data_idx";
drop index "app"."users_email_lower_idx";
create index "docs_data_idx" on "app"."docs" using gin ("data");
create index "users_email_lower_idx" on "app"."users" (lower(btrim("app"."users"."email")));
```

Banner: `-- ~ table app.docs [index "docs_data_idx" changed]` (existing
`tableFieldDiffNotes`).

## step-2 (`--rename app.users.email=email_address`)

```sql
alter table "app"."users" rename column "email" to "email_address";
drop index "app"."users_email_lower_idx";
create index "users_email_lower_idx" on "app"."users" (lower(btrim("app"."users"."email_address")));
```

The explicit name is kept (never derived); the expression is retargeted;
no `ambiguous-column-rename`.

## Unchanged

- `drop index "<schema>"."<name>";` on removal.
- A 0.1.1 project with only B-tree indexes: **no statements, no snapshot
  change** (SC-004; asserted by a test that serializes the existing
  `table-indexes` golden declarations and compares to its committed
  `expected/snapshot.json`).
