# Query layer

Read this when writing typed queries against a declared schema — building
a `db()` handle, chaining `select`/`insert`/`update`/`deleteFrom`, calling
a declared function through `db.fn`, running under an RLS execution
context, or reading a query-layer error.

## Building a handle

A handle is a declared schema module plus a driver: `db(schema, driver,
options?)`. `@hejbro/pg`'s `pgDriver` is the vanilla Postgres driver —
`pgDriver(pool)` or `pgDriver(connectionString)`, both returning a
`Driver` whose `.client` is the underlying `pg` `Pool` (never
auto-closed; call `driver.client.end()` yourself for teardown).

```ts
import { pgDriver } from "@hejbro/pg";
import { db, schema, table, text, uuid } from "hejbro";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

const driver = pgDriver(process.env.DATABASE_URL ?? "postgres://localhost:5432/app");
const handle = db({ posts }, driver);
```

`@hejbro/supabase`'s `supabaseDriver(driver)` wraps any driver (usually
`pgDriver(...)`) to contribute Supabase's `anon`/`authenticated`/
`service_role` roles to `db.as`'s declared-role whitelist — see "RLS
execution context" below.

## The chain surface

`handle.select`/`insert`/`update`/`deleteFrom` mirror core's own
`select(table)`/`insert(target).values(rows)`/`update(target).set(values)`/
`deleteFrom(target)` builders stage for stage — `.where()`/`.orderBy()`/
`.limit()`/`.innerJoin()`/`.leftJoin()`/`.returning()`/
`.onConflictDoNothing()`/`.onConflictDoUpdate()` all delegate straight to
the corresponding core builder stage. A chain is inert until awaited — no
statement reaches any driver while it's still being built — and
`.compile()` on any stage previews the SQL/parameters without ever
touching the driver.

```ts prelude=query-handle
import { eq } from "hejbro";

const published = await handle
	.select(posts)
	.where(eq(posts.status, "published"))
	.orderBy(posts.id)
	.limit(10);

const preview = handle
	.select(posts)
	.where(eq(posts.status, "published"))
	.compile();

const inserted = await handle
	.insert(posts)
	.values({ id: crypto.randomUUID(), status: "draft" })
	.returning({ insertedId: posts.id });

const archived = await handle
	.update(posts)
	.set({ status: "archived" })
	.where(eq(posts.status, "draft"))
	.returning({ archivedId: posts.id });

const deleted = await handle
	.deleteFrom(posts)
	.where(eq(posts.status, "draft"))
	.returning({ deletedId: posts.id });
```

A mutation without `.returning()` resolves to an empty array and still
runs — `await handle.update(posts).set({ status: "archived" })` executes
the update, it just has no rows to hand back.

## Type inference

A whole-table `select(table)` (or `.returning()`/insert-`returning`)
infers each column's TypeScript type from its declaration, nullability
included — a column without `.notNull()` types as possibly `null`. An
array column's element type includes `| null` by default (Postgres arrays
are element-nullable regardless of the column's own `notNull`), except a
column declared `.notNullElements()`, whose element type is the bare
element type — the emitted CHECK backs that promise, and if it's ever
dropped out-of-band a `NULL` element arriving at read time is a fail-fast
`result-conversion-failed`, never a silent lie. An object projection
(`select({ alias: expr }, table)`) still keys the result exactly to the
projected names, but each field's type is only its coarse SQL family
widened to nullable — an expression carries no link back to a declared
column (tracked as #311).

Insert input types require every `notNull`-without-default column and
accept the rest as optional; update input types accept any column as
optional. Every column's accepted *value* type is its own declared read
type: a `bigint`/`numeric` column accepts whatever its mode reads back as
(`bigint`, `number`, or `string`), an `interval` column accepts a
structured `IntervalValue`, a `date`/`timestamp`/`timestamptz` column
accepts exactly `Date` (never a plain ISO string), and a `json`/`jsonb`/
`bytea` column accepts only an `Expr` (the `sql` escape hatch) — there is
no compile-time-lifted raw-value write path for those three.

```ts prelude=query-handle
import type { IntervalValue } from "hejbro";
import { eq } from "hejbro";

const numericRows = await handle.select(posts).where(eq(posts.status, "published"));
const amount: bigint | null = numericRows[0]?.amount ?? null;

const withInterval = await handle.select(posts);
const readingTime: IntervalValue | null = withInterval[0]?.readingTime ?? null;
const tags: ReadonlyArray<string | null> | null = withInterval[0]?.tags ?? null;

const written = await handle
	.insert(posts)
	.values({
		id: crypto.randomUUID(),
		status: "published",
		readingTime: { years: 0, months: 0, days: 0, hours: 0, minutes: 5, seconds: 0, microseconds: 0 },
	})
	.returning();
```

An array column declared `.notNullElements()` narrows its element type on
both the read and write side; `assertNoNulls` (importable from `hejbro`)
runtime-checks a `ReadonlyArray<T | null>` down to `ReadonlyArray<T>` when
a caller needs to hand a possibly-nullable array to a column typed that
way, throwing on the first `null` element rather than silently dropping
it — it narrows, it never filters.

## Calling a declared function

`db.fn` exposes every `defineFunction` declaration in the schema module
as a typed callable — argument and result types come straight from the
declaration, and a missing/extra/mis-typed argument is a compile error,
never a runtime coercion. A scalar-returning function resolves to the
mapped scalar value; a table-returning function resolves to typed rows,
with the rendered SQL listing the returned columns explicitly.

```ts
import { pgDriver } from "@hejbro/pg";
import { db, defineFunction, eq, schema, select, table, text, uuid } from "hejbro";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});
const searchByStatus = defineFunction(
	app,
	"search_by_status",
	{ args: { status: text() }, returns: posts },
	(ctx, args) => {
		ctx.return(select(posts).where(eq(posts.status, args.status)));
	},
);

const driver = pgDriver(process.env.DATABASE_URL ?? "postgres://localhost:5432/app");
const handle = db({ posts, searchByStatus }, driver);

const rows = await handle.fn.searchByStatus({ status: "published" });
```

## RLS execution context

`db.as({ role, settings? })` returns a handle scoped to that role/session
context: everything it runs shares one wrapping transaction that applies
`SET LOCAL ROLE` and each setting via a parameterized `set_config` call
before the statement — nothing persists on the connection afterwards, and
the unscoped handle stays untouched. The role must already be in the
declared whitelist (any `grant`'s role, any RLS policy's role, an
explicit `db(schema, driver, { roles: [...] })` opt-in, or a role the
driver itself contributes) or the call fails immediately with
`undeclared-role`, before anything reaches the database.

`@hejbro/supabase` provides the concrete context builders for its own
convention: `asUser(claims)` fixes role `authenticated`, requires a `sub`
claim (fails fast with `claims-subject-missing` otherwise), always
discards any caller-supplied `role` claim, and serializes `claims` into
the single `request.jwt.claims` session setting; `asAnon()` fixes role
`anon` with no claims required. Neither ever accepts a raw JWT string —
callers pass their own already-verified claims object (e.g. supabase-js's
`getClaims()`).

```ts
import { pgDriver } from "@hejbro/pg";
import { asAnon, asUser, supabaseDriver } from "@hejbro/supabase";
import { db, schema, table, text, uuid } from "hejbro";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

const driver = supabaseDriver(
	pgDriver(process.env.DATABASE_URL ?? "postgres://localhost:5432/app"),
);
const handle = db({ posts }, driver);

const asOwner = await handle.as(asUser({ sub: "00000000-0000-0000-0000-000000000000" })).select(posts);
const asGuest = await handle.as(asAnon()).select(posts);
```

Executing under a context on a driver without the interactive-transaction
capability fails immediately with the explicit missing-capability error
(see "Errors" below) — `@hejbro/pg`'s and `@hejbro/supabase`'s own
drivers both declare it.

## Transactions

`handle.transaction(async (tx) => { ... })` runs every statement issued
through `tx` on one held connection inside `begin`/`commit`, committing on
a normal return and rolling back — with the thrown error propagating
unchanged — when the callback throws. `tx` carries the same
`select`/`insert`/`update`/`deleteFrom`/`fn` surface as any other handle.
Calling `transaction()` again from inside an already-open callback of
that same member fails fast with `nested-transaction-unsupported` before
any further statement is sent — there is no flattening into the outer
transaction and no second, unrelated transaction opened.

```ts prelude=query-handle
const result = await handle.transaction(async (tx) => {
	const [post] = await tx
		.insert(posts)
		.values({ id: crypto.randomUUID(), status: "draft" })
		.returning();
	await tx.insert(comments).values({ id: crypto.randomUUID(), postId: post.id });
	return post;
});
```

## Errors

Every query-layer error is a plain `Error` carrying a `code` field and,
where relevant, a `cause` — never a thrown string, never a swallowed or
retried failure. The message always ends in a `Next:` sentence naming the
concrete next step.

| `code` | When |
|---|---|
| `query-execution-failed` | The driver rejected an executed statement (e.g. a constraint violation) — the message carries the parameterized SQL text; the statement's parameter *values* never appear on the error, not in the message, not as a field. |
| `result-conversion-failed` | A returned column's value couldn't convert to its declared type (an unconvertible/missing column, an array arrival-shape mismatch, or a `NULL` element under `.notNullElements()`). |
| `driver-missing-capability` | An operation (a transaction, a `db.as` context) needs a capability the active driver doesn't declare `true`. |
| `nested-transaction-unsupported` | `transaction()` was called again from inside its own already-open callback. |
| `undeclared-role` | `db.as({ role, ... })`'s role isn't in the declared whitelist. |
| `claims-subject-missing` | `@hejbro/supabase`'s `asUser(claims)` was called without a `sub` claim. |

## Where this is enforced

- Specs: `openspec/specs/query-builder/spec.md`,
  `openspec/specs/query-execution/spec.md`,
  `openspec/specs/query-type-inference/spec.md`,
  `openspec/specs/driver-contract/spec.md`,
  `openspec/specs/rls-execution-context/spec.md`,
  `openspec/specs/typed-function-execution/spec.md`,
  `openspec/specs/value-utilities/spec.md`.
- Code: `packages/query/src/db/db.ts` (`db()`, the `Db` type), `packages/query/src/db/chain.ts` (chain delegation), `packages/query/src/db/context.ts` (`db.as`, the role whitelist), `packages/query/src/db/transaction.ts`, `packages/query/src/db/fn.ts` (`db.fn`), `packages/query/src/driver/contract.ts` (capabilities), `packages/pg/src/driver.ts` (`pgDriver`), `packages/supabase/src/context.ts` (`asUser`/`asAnon`), `packages/supabase/src/driver.ts` (`supabaseDriver`), `packages/core/src/types/assert-no-nulls.ts` (`assertNoNulls`).
- Gates: every path cited above is checked by `packages/skills/test/links.test.ts`; every `ts` block on this page is type-checked against this repo's real source by `packages/skills/test/snippet-compile.test.ts`.
