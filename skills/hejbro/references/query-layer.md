# Query layer

Read this when writing typed queries against a declared schema — building
a `db()` handle, chaining `select`/`insert`/`update`/`deleteFrom`, using
the `sql` escape hatch, calling a declared function through `db.fn`,
running under an RLS execution context, or reading a query-layer error.

## Building a handle

A handle is a declared schema module plus a driver: `db(schema, driver,
options?)`. `@hejbro/pg`'s only export is `pgDriver` — the vanilla
Postgres driver: `pgDriver(pool)` or `pgDriver(connectionString)`, both
returning a `Driver` whose `.client` is the underlying `pg` `Pool` (never
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
`deleteFrom(target)` builders stage for stage — every stage delegates
straight to the corresponding core builder stage (D94: the query layer
never builds a second statement vocabulary). **There is no `.from()`
chain step** — `select`'s second argument (`select(projection, from?)`)
*is* the table, passed positionally, not a stage you chain afterward:

```ts prelude=query-handle expect-error=2339
// WRONG — .from() doesn't exist on the chain; this fails to type-check.
await handle.select(posts).from(posts);
```

```ts prelude=query-handle
import { eq } from "hejbro";

// select(table) projects every declared column; select({alias: expr}, table)
// projects an explicit object of expressions. Neither ever renders
// `select *` — the projection is always an explicit column list.
const published = await handle
	.select(posts)
	.where(eq(posts.status, "published"))
	.orderBy(posts.id)
	.limit(10)
	.offset(20);

// distinct comes first, where SQL puts it — between `select` and the
// projection — so it is available on the first stage and exactly once.
// `distinctOn` is Postgres's own: one row per group, and WHICH row is
// decided by the order by, whose leading terms must be those columns.
const latestPerStatus = await handle
	.select(posts)
	.distinctOn(posts.status)
	.orderBy(posts.status, { by: posts.publishedAt, direction: "desc" });

// .compile() is a pure preview — it never touches the driver, and the
// chain itself sends nothing until it is actually awaited. What a driver
// receives when a chain IS awaited is byte-identical to what .compile()
// already showed (same SQL text, same parameter list).
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

// .innerJoin()/.leftJoin() take the joined table and an equality
// condition, same as core's own select(...).innerJoin(...).
const withComments = await handle
	.select(posts)
	.innerJoin(comments, eq(posts.id, comments.postId));
```

An insert chain also has `.onConflictDoNothing(...target columns)` and
`.onConflictDoUpdate({ target: [...], set: {...} })`, mirroring core's
own `insert(...).onConflictDoNothing()`/`.onConflictDoUpdate()` stages —
an upsert is still an `insert` chain, not a separate entry point.

A `returning()` (and a function's own returned-row projection) is under
the same rule as `select` — always an explicit column list, never
`returning *`. A mutation without `.returning()` resolves to an empty
array and still runs — `await handle.update(posts).set({ status:
"archived" })` executes the update, it just has no rows to hand back.

## Relational reads (nested rows)

Two layers, one truth: the foreign keys the schema already declares.
There is no separate relations declaration anywhere.

The sugar — `related()` derives nested reads from `.references()`
edges. A reverse key is the referencing table's name in your `db()`
schema map (`comments`); a forward key is the FK column's TypeScript
name minus its `Id` tail (`postId` → `post`). v1 takes `true` per key,
direct relations only:

```ts prelude=query-handle
const rows = await handle.select(posts).related({ comments: true });
// rows[0].comments: ReadonlyArray<{ id: string; postId: string; body: string | null }>
// an empty collection arrives as [], never null
const fromChild = await handle.select(comments).related({ post: true });
// fromChild[0].post: the full posts row, or null
```

The base layer — the same reads written explicitly, for anything the
sugar doesn't shape (filtered children, computed nested columns,
grandchildren). `jsonArrayFrom(subselect)` is a collection,
`jsonObjectFrom(subselect)` a single row; the subselect is the
ordinary `select()` builder and may reference the enclosing query's
columns:

```ts prelude=query-handle
import { eq, jsonArrayFrom, select } from "hejbro";

const posts2 = await handle.select(
	{
		id: posts.id,
		comments: jsonArrayFrom(
			select({ id: comments.id, body: comments.body }, comments)
				.where(eq(comments.postId, posts.id))
				.orderBy(comments.id),
		),
	},
	posts,
);
```

Everything compiles to one statement — a correlated subquery visible
in `compile()`, casts included — and runs as one statement under an
RLS context (nested rows obey the context's policies; the database
filters them inside the same read). Values arrive revived: a nested
`bigint` is a `bigint` (text-cast in SQL so precision survives the
JSON round trip), datetimes arrive as `Date` (`date` at local
midnight), `interval` and `bytea` ride the driver's session pins. A
relation key that collides with a projected column, mixes in a typo,
or matches nothing fails to type-check — and the runtime throws
`ambiguous-relation`/`unknown-relation` rather than guessing.

## Set operations

`.union()`, `.unionAll()`, `.intersect()`, `.intersectAll()`,
`.except()`, and `.exceptAll()` combine selects into one statement —
nesting composes, and `orderBy`/`limit` called AFTER a combination
govern the whole set (rendered as bare output column names, Postgres's
own set-op rule; ordering by anything outside the left branch's output
columns fails loudly):

```ts prelude=query-handle
import { eq } from "hejbro";

const drafts = handle.select(posts).where(eq(posts.status, "draft"));
const published = handle
	.select(posts)
	.where(eq(posts.status, "published"));
const rows = await drafts.union(published).orderBy(posts.status).limit(10);
// rows: the deduplicated combined set; .unionAll keeps duplicates
```

Branches must be row-compatible — mismatched key sets fail to
type-check (the database would reject the statement). The result types
as the LEFT branch's keys with per-column unions (a column nullable in
either branch is nullable in the result), and rows arrive converted
per the left branch's declarations. A set-operation query is also a
valid view body (`defineView` accepts it; the view's columns come from
the left branch).

## The `sql` escape hatch and injection safety

`sql` is the typed tagged-template escape hatch for anything the builder
vocabulary doesn't cover — usable in a projection, as an insert/update
value, as a condition, or compiled standalone as its own statement (it
types as `Expr<"unknown">`, which every column's write type accepts
alongside its own declared read type).

**A `sql` fragment is a condition in both media.** Every condition
position takes `Expr<"boolean"> | Expr<"unknown">` — in a *declaration*
`check(name, expression)`, an RLS policy's `using`/`withCheck`, an
index's `.on(sql\`...\`)`/`.where(...)` (see `dsl-cheatsheet.md`); in a
*query* the chain's `.where()`/`.innerJoin()`/`.leftJoin()`, an update's
and a delete's `.where()`, and `related()`'s `.where()`. So a predicate
the typed operators can't build — `lower(email) = $1`, a regex match, an
arbitrary function call — goes straight in, no cast:

```ts prelude=query-handle
import { and, eq, sql } from "hejbro";

const drafts = await handle
	.select(posts)
	.where(sql`lower(${posts.status}) = ${"draft"}`);

const shortDrafts = await handle
	.select(posts)
	.where(and(eq(posts.status, "draft"), sql`char_length(${posts.status}) > ${3}`));
```

Interpolations become bind parameters exactly as they do anywhere else.
Prefer a typed operator (`eq`, `gt`, `inArray`, `between`, …) when one
expresses the predicate — it keeps the family checked — and reach for
`sql` when none does. Importing `sql` from the
`hejbro` facade gets you the query-capable one: the facade re-exports
`@hejbro/core` and `@hejbro/query` wholesale, and `@hejbro/query`'s own
`sql` is exported a second time right after, so it — not core's
declaration-only `sql` — is the barrel's single `sql` (an ES module named
export wins over a colliding `export *`). One import works in both media:
written into a declaration it renders interpolated values as inline
literals (migration SQL has to stay diffable); compiled as part of a
query it lifts the same values to bind parameters.

Every value interpolated into a `sql` template — and every value entering
a statement any other way (a `where` condition, an insert's values, an
update's `set`, a projection) — becomes a bind parameter, never inlined
text. `sql.raw(rawText)` is the **one verbatim path** into the compiled
SQL text: the caller is responsible for what it passes there, and nothing
else in the query layer renders caller-supplied text uninterpreted. The
only values that *do* render inline (not as caller text, and not through
`sql.raw`) are a validated non-negative `limit` and the internal `default`
marker a multi-row insert uses for a missing key.

```ts prelude=query-handle
import { sql } from "hejbro";

// sql fragments type as Expr<"unknown"> — usable in a projection (an
// object-projection field, like here), as a condition, or as a whole
// standalone statement.
const withLowerStatus = await handle.select(
	{ id: posts.id, lowerStatus: sql`lower(${posts.status})` },
	posts,
);
```

## Type inference

A whole-table `select(table)` (or `.returning()`/insert-`returning`)
infers each column's TypeScript type from its declaration, nullability
included — a column without `.notNull()` types as possibly `null`. An
array column's element type includes `| null` by default (Postgres arrays
are element-nullable regardless of the column's own `notNull`), except a
column declared `.notNullElements()`, whose element type is the bare
element type — the emitted CHECK backs that promise, and if it's ever
dropped out-of-band a `NULL` element arriving at read time is a fail-fast
`result-conversion-failed`, never a silent lie (the raw `NULL` is never
handed back as a bare-typed `null`). An object projection
(`select({ alias: expr }, table)`) keys the result exactly to the
projected names, and a projected *declared column* keeps its declared
type — numeric mode, array element, the `$type` brand and all
(`select({ total: posts.amount }, posts)` reads `total` as `bigint`,
not the family-wide `number | bigint | string`). A field built from
anything else — a `sql` fragment, a computed expression — still resolves
to its coarse SQL family, which is all such a value carries.

Every object-projection field is nullable, including one from a
`.notNull()` column. The projection's type is fixed at `select()` time,
before `.leftJoin()` can be chained onto it, so a left join really can
null any of them and this layer cannot yet see which tables were
left-joined (tracked as #307). Whole-table selects and `returning()`
without a projection are unaffected — they carry declared nullability.

Insert input types require every `notNull`-without-default column and
accept the rest as optional; update input types accept any column as
optional. Every column's accepted *value* type is its own declared read
type: a `bigint`/`numeric` column accepts whatever its mode reads back as
(`bigint`, `number`, or `string`), an `interval` column accepts a
structured `IntervalValue`, a `date`/`timestamp`/`timestamptz` column
accepts exactly `Date` (never a plain ISO string), and a `json`/`jsonb`/
`bytea` column accepts only an `Expr` (the `sql` escape hatch) — there is
no compile-time-lifted raw-value write path for those three. On the read
side, a `jsonb` column surfaces as `unknown` unless its declaration opts
into a `.$type<T>()` brand — the branded `T` flows through the **result**
type; the write side stays `Expr`-only, so the brand never appears on
the insert/update input type.

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
with the rendered SQL listing the returned columns explicitly (the same
never-`select *` rule as any other statement). `db.fn` composes with a
context: `db.as(context).fn.*` is the same typed surface, and each call
runs inside that context's own transaction — the role and settings apply
before the function's own invocation, exactly like any other statement
on a scoped handle.

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

`db.as(context)` returns a handle scoped to that role/session context:
everything it runs shares one wrapping transaction that applies the role
and settings with transaction-local scope before the statement runs, so
nothing persists on the connection afterwards, and the unscoped handle
stays untouched. Executing under a context on a driver without the
interactive-transaction capability fails immediately with the explicit
missing-capability error (see "Errors" below), before anything reaches
the database.

**There is no `asRole()`/`roleContext()` helper on the vanilla surface.**
`DbContext` is a plain object literal — `{ role, settings? }` — passed
directly to `db.as(...)`; `role` is a branded `Role` from core's
`roleName("...")`, or one of a preset's own role constants
(`anonRole`/`authenticatedRole`/`serviceRole` from `@hejbro/supabase`).
The role must already be in the declared whitelist — a `grant`'s role,
an RLS policy's role, an explicit `db(schema, driver, { roles: [...] })`
opt-in, or a role the driver itself contributes — with **no special case
for `"public"`**, or the call fails immediately with `undeclared-role`,
listing the roles that are declared, before any statement reaches the
database. The role reaches Postgres via a quoted `SET LOCAL ROLE`
(`quoteIdentifier`, so an embedded quote is doubled rather than passed
through raw — `SET LOCAL ROLE` takes no bind parameter); every session
setting reaches it via a parameterized `select set_config($1, $2, true)`
call instead, one per entry.

```ts prelude=query-handle
import { roleName } from "hejbro";

const scopedHandle = db({ posts, comments }, driver, { roles: [roleName("app_reader")] });
const asReader = await scopedHandle
	.as({ role: roleName("app_reader"), settings: { "app.tenant_id": "123" } })
	.select(posts);
```

`@hejbro/supabase` provides the concrete context builders for its own
convention — `asUser(claims)` and `asAnon()` — on top of that same
generic mechanism: `asUser(claims)` accepts an arbitrary **claims
object** (must carry `sub`; fails fast with `claims-subject-missing`
otherwise), always fixes role `authenticated` and discards any
caller-supplied `role` claim, and serializes `claims` (merged with the
fixed role) into exactly **one** session setting, `request.jwt.claims`;
`asAnon()` fixes role `anon` with `{"role":"anon"}` and no `sub`
requirement. **Neither ever accepts a raw JWT string** — token
verification stays with the calling application: callers pass their own
already-verified claims object (e.g. supabase-js's `getClaims()`, or a
`jose` verification against a custom JWKS).

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

## Transactions

`handle.transaction(async (tx) => { ... })` runs every statement issued
through `tx` on one held connection inside `begin`/`commit`, committing on
a normal return and rolling back — with the thrown error propagating
unchanged — when the callback throws. `tx` carries the same
`select`/`insert`/`update`/`deleteFrom`/`fn` surface, resolving the exact
same inferred types, as any other handle. **Nest on `tx`, not on the handle.** `tx.transaction(async (nested) =>
{ ... })` brackets its callback with a `savepoint`, releases it on a
normal return and rolls back to it — rethrowing the error unchanged — on
a throw, all on the same connection. A rolled-back nested transaction
does *not* abort the transaction containing it, so the outer callback can
catch the error and keep issuing statements that still commit.

Calling `transaction()` on the **handle** from inside an already-open
callback of that same member still fails fast with
`nested-transaction-unsupported` **before any further statement is sent**
— that call would take a second connection out of the pool rather than
nest, so it is rejected rather than silently flattened into the outer
transaction or opened as a second, unrelated one.

```ts prelude=query-handle
const result = await handle.transaction(async (tx) => {
	const [post] = await tx
		.insert(posts)
		.values({ id: crypto.randomUUID(), status: "draft" })
		.returning();
	await tx.insert(comments).values({ id: crypto.randomUUID(), postId: post.id });

	// nested: this one may fail without taking the post insert with it
	await tx
		.transaction(async (nested) => {
			await nested
				.insert(comments)
				.values({ id: crypto.randomUUID(), postId: post.id });
		})
		.catch(() => undefined);

	return post;
});
```

## Not supported in this version

These read naturally as query-builder features but aren't there yet —
use the `sql` escape hatch, or wait for the tracked issue:

- CTEs and window functions outside the `sql` escape hatch (#417, #416)
  — write them with `sql` until those land.
- `@hejbro/neon` and `@hejbro/nile` presets (#300, #301) — only
  `@hejbro/pg` (vanilla) and `@hejbro/supabase` exist today.
- A startup assertion that the connected database matches the checked-out
  snapshot (#302).
- Prepared-statement caching (#303) — every execution compiles and sends
  fresh.

## Errors

Every query-layer error is a plain `Error` carrying a `code` field and,
where relevant, a `cause` — never a thrown string, never a swallowed or
retried failure. The message always ends in a `Next:` sentence naming the
concrete next step.

| `code` | When |
|---|---|
| `query-execution-failed` | The driver rejected an executed statement (e.g. a constraint violation) — the message carries the parameterized SQL text; the statement's parameter *values* never appear on the error, not in the message, not as a field, not via its string or JSON form. |
| `result-conversion-failed` | A returned column's value couldn't convert to its declared type (an unconvertible/missing column, an array arrival-shape mismatch, or a `NULL` element under `.notNullElements()`). |
| `driver-missing-capability` | An operation (a transaction, a `db.as` context) needs a capability the active driver doesn't declare `true` — a capability explicitly declared `false` fails exactly like an undeclared one, never attempted. The capability set itself is fixed and exhaustive: a driver's own declaration must name every one of them, and omitting one, or naming one outside the set, fails to type-check rather than defaulting silently — this is a compile-time guarantee, checked before this runtime error's own path is ever reached. |
| `nested-transaction-unsupported` | The db handle's `transaction()` was called again from inside its own already-open callback — nest with `tx.transaction(...)` instead. |
| `savepoint-rollback-failed` | Rolling back to a nested transaction's savepoint itself failed; the rollback failure is on `cause` and the callback's own error on `callbackError`. |
| `undeclared-role` | `db.as({ role, ... })`'s role isn't in the declared whitelist. |
| `claims-subject-missing` | `@hejbro/supabase`'s `asUser(claims)` was called without a `sub` claim. |

## Where this is enforced

- Specs: `openspec/specs/query-builder/spec.md` (chain surface, `sql`
  escape hatch, injection safety, column-explicit rendering),
  `openspec/specs/query-execution/spec.md` (execution, error
  propagation, nested transactions, result conversion),
  `openspec/specs/query-type-inference/spec.md`,
  `openspec/specs/driver-contract/spec.md` (capabilities),
  `openspec/specs/rls-execution-context/spec.md` (role whitelist,
  `SET LOCAL ROLE`/`set_config`, Supabase claims contexts),
  `openspec/specs/typed-function-execution/spec.md`,
  `openspec/specs/table-declaration/spec.md` (`.notNullElements()`'s
  backing CHECK),
  `openspec/specs/value-utilities/spec.md` (`assertNoNulls`).
- Code: `packages/query/src/db/chain.ts` (`select`'s positional `from`
  argument, lines 374-398 — no `.from()` stage; `insert`/`update`/
  `deleteFrom`), `packages/query/src/sql.ts` (`sql`, `sql.raw`,
  `sql.identifier`), `packages/core/src/query/mutate.ts`
  (`MutationValue`'s `Expr<"unknown">` arm — every column's write type
  accepts a `sql` fragment), `packages/core/src/expr/ast.ts`
  (`Condition` — the `Expr<"boolean"> | Expr<"unknown">` union every
  condition position takes, in both media), `packages/core/src/query/
  select.ts` and `packages/core/src/dsl/check.ts` (two of its
  application sites),
  `packages/query/src/db/execute.ts` (`query-execution-failed`, params
  never read), `packages/query/src/db/db.ts` (`db()`, the role union),
  `packages/query/src/db/context.ts` (`db.as`, `DbContext`, the role
  whitelist, `SET LOCAL ROLE`/`set_config` rendering),
  `packages/query/src/db/transaction.ts` (`nested-transaction-unsupported`),
  `packages/query/src/db/fn.ts` (`db.fn`),
  `packages/query/src/driver/contract.ts` and
  `packages/query/src/driver/errors.ts` (capabilities,
  `driver-missing-capability`),
  `packages/query/src/db/convert.ts` (`.notNullElements()` NULL
  fail-fast), `packages/pg/src/driver.ts` (`pgDriver`),
  `packages/supabase/src/context.ts` (`asUser`/`asAnon`,
  `claims-subject-missing`), `packages/supabase/src/driver.ts`
  (`supabaseDriver`), `packages/core/src/types/assert-no-nulls.ts`
  (`assertNoNulls`), `packages/cli/src/index.ts` (the `sql` shadow, lines
  23-24), `packages/cli/test/exports.test.ts` (the shadow pinned by test,
  lines 38-50 and 52-69).
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; every `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
