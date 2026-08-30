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

`supabaseDriver` also takes an optional second argument naming the Supabase connection path the driver was built against — see supabase-preset.md's "Connecting" section.

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
import { asc, desc, eq } from "hejbro";

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
//
// `orderBy` accepts the same `asc(...)`/`desc(...)` vocabulary a declared
// index's own column order already does — a bare column orders ascending
// with no explicit nulls placement (as `posts.id` did above); wrap it to
// pick a direction and, optionally, an explicit `nulls: "first" | "last"`
// placement, rendered as Postgres's own `nulls first`/`nulls last` right
// after the direction. A window specification's own `orderBy` (see below)
// and a set operation's whole-set `orderBy` take the identical vocabulary.
const latestPerStatus = await handle
	.select(posts)
	.distinctOn(posts.status)
	.orderBy(posts.status, desc(posts.publishedAt, { nulls: "last" }));

// asc(...) is the explicit-direction, ascending counterpart — useful
// mainly to pair with a nulls placement, since a bare column already
// orders ascending with no placement:
const oldestFirstNullsFirst = await handle
	.select(posts)
	.orderBy(asc(posts.publishedAt, { nulls: "first" }));

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
own `insert(...).onConflictDoNothing(posts.slug)`/`.onConflictDoUpdate()`
stages — an upsert is still an `insert` chain, not a separate entry
point. The conflict target must name at least one declared column: an
empty target fails fast with `empty-conflict-target` (Postgres rejects
`on conflict ()`), and the target-less `on conflict do nothing` form is
written through the `sql` escape hatch.

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

## Common table expressions (CTEs)

`withCte((w) => { ... })` builds a `WITH` statement: `w.as(name, query,
options?)` declares an entry and hands back a typed reference to it, usable
anywhere a `from` source is expected (`select(projection, ref)`) — but never
as a join *target*: `.innerJoin()`/`.leftJoin()` still only accept a real
declared `Table`, so a CTE reference always goes on the FROM side of a join,
never the joined-in side. The callback's own return value is the
statement's body — the query actually run and returned.

On a `db()` handle, the identical builder is `handle.with((w) => { ... })`
— the same `w.as`/`w.asRecursive` callback, not a second API. `with` is a
reserved JS word, so a top-level `export const with = ...` doesn't
type-check; that is why the standalone core export is named `withCte` (the
same escape `deleteFrom` already uses for `delete`). As an object
*method*, `with` is a legal name — property keys aren't restricted the way
top-level declarations are — so the chain keeps the plain name.

```ts prelude=query-handle
import { eq, gt, over, rowNumber, select } from "hejbro";

// a window function inside a CTE, filtered outside it -- the motivating
// case: the outer query can filter on a windowed value the projection
// alone couldn't express.
const ranked = await handle.with((w) => {
	const r = w.as(
		"ranked",
		select(
			{
				id: posts.id,
				status: posts.status,
				rn: over(rowNumber(), { partitionBy: [posts.status], orderBy: [posts.id] }),
			},
			posts,
		),
	);
	return select({ id: r.id, status: r.status }, r).where(gt(r.rn, 1));
});

// an entry may reference an earlier entry -- "recent" selects from
// "drafts", not from the base table.
const recentDrafts = await handle.with((w) => {
	const drafts = w.as(
		"drafts",
		select(posts).where(eq(posts.status, "draft")),
	);
	return select({ id: drafts.id }, drafts).orderBy(drafts.id).limit(5);
});
```

An entry can reference an earlier entry, but never a later one or itself
(without `asRecursive`, below) — the builder only ever hands out a
reference to an entry already declared, so a forward reference is
unrepresentable rather than merely refused. `options?.materialized` is a
tri-state hint (`true`/`false`/omitted) rendering Postgres's own
`MATERIALIZED`/`NOT MATERIALIZED`/neither; both tokens are accepted, live
verified against a real postgres:17.

### Recursive CTEs

`w.asRecursive(name, anchor, (self) => recursiveTerm, options?)` declares a
recursive entry: `anchor` fixes the CTE's own column names and types
(Postgres takes a recursive CTE's row shape from its anchor, never the
recursive term), and `recursiveTerm` is written inside a callback receiving
a reference (`self`) typed from the anchor. The recursive term must project
the same **keys** as the anchor — a missing or extra key doesn't
type-check — but each key may be *computed* differently on either side (the
recursive term commonly needs a window function or an aggregate the anchor
doesn't): a recursive CTE is grammatically `anchor UNION [ALL]
recursive-term`, so this is the same union-compatibility rule
`.union()`/`.unionAll()` already apply between any two branches, not a
second one.

```ts prelude=query-handle
import { eq, select } from "hejbro";

const rootId = "00000000-0000-0000-0000-000000000000";

// every descendant of a root category, walking down the tree.
const descendants = await handle.with((w) => {
	const r = w.asRecursive(
		"r",
		select({ id: categories.id, name: categories.name }, categories).where(
			eq(categories.id, rootId),
		),
		(self) =>
			select({ id: categories.id, name: categories.name }, self).innerJoin(
				categories,
				eq(self.id, categories.parentId),
			),
	);
	return select({ id: r.id, name: r.name }, r);
});
```

The self-reference (`self`) always goes on the FROM side of the recursive
term, never the join target — same rule as any other CTE reference above.

A window function in the recursive term, `distinct`, `distinct on`,
`group by`/`having`, and an aggregate in the *anchor* term are all
accepted — measured on postgres:17, and worth stating plainly because the
widely recalled restriction list ("no aggregates, no window functions, no
`distinct`, no `group by`") is not in the PostgreSQL manual and turned out
wrong on four counts. What a recursive term itself refuses: an aggregate at
its own select level, `order by`/`limit`/`offset` (unimplemented for a
recursive query), a second self-reference, a self-reference inside a
subquery or in the anchor, and `intersect`/`except` as the combinator — the
last two and the three whole-set clauses can't even be spelled here:
`w.asRecursive`'s own recursive branch offers only `union`/`unionAll`, no
further chain of combinators, so those five shapes are unrepresentable
through this builder rather than merely rejected.

**Caveat: a self-reference on the non-nullable side of a `LEFT JOIN` is
accepted by Postgres and does not terminate on its own.** Written as
`select({...}, self).leftJoin(realTable, ...)` (`self` outer-joined
against the real table, rather than the `innerJoin` above), every iteration
still yields at least one row — nothing ever empties the working table.
Postgres allows this shape, so hejbro does not refuse it either; pair it
with a depth guard in the recursive term's own `where` clause (`where
self.depth < N`) or a `statement_timeout`, the same way a hand-written
recursive `LEFT JOIN` query would need one. `not materialized` on a
recursive entry is accepted too — Postgres documents that it *ignores* the
hint there rather than erroring, also live verified.

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
accepts exactly `Date` (never a plain ISO string), a `json`/`jsonb` column
accepts any JSON-serializable value (hejbro serializes it; the declared
type decides between `json` and `jsonb`) — a written `null` becomes SQL
NULL, not the JSON document `null` (`is null` finds it, a `notNull`
column refuses it); write the JSON document `null` itself through the
`sql` escape hatch (`` sql`'null'::jsonb` ``) — and a `bytea` column
accepts a `Uint8Array` (hex-encoded for you — never a string, whose
encoding would have to be guessed). On the read side, a `jsonb` column
surfaces as `unknown` unless its declaration opts into a `.$type<T>()`
brand — and since the write type is the read type, the brand narrows
**both**: a branded column accepts its own `T` and nothing else.

```ts
import { bytea, db, jsonb, schema, table, uuid } from "hejbro";
import { pgDriver } from "@hejbro/pg";

const shop = schema("shop");
const docs = table(shop, "docs", {
	id: uuid().primaryKey(),
	settings: jsonb().$type<{ readonly theme: string }>().notNull(),
	blob: bytea().notNull(),
});
const store = db({ docs }, pgDriver(process.env.DATABASE_URL ?? ""));

// no JSON.stringify, no ::jsonb cast, no hex encoding written by hand —
// and `{ theme: 1 }` would not type-check, because the brand narrows the
// write exactly as it narrows the read.
await store.insert(docs).values({
	id: crypto.randomUUID(),
	settings: { theme: "dark" },
	blob: new Uint8Array([0, 255]),
});
```

An array of `json`/`jsonb`/`bytea` is still `Expr`-only — those element
types need their own array-literal escaping rules, so `sql` remains the
way to write one.

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

**Only one nested transaction in flight per `tx` at a time.** Starting a
second one — `await Promise.all([tx.transaction(a), tx.transaction(b)])`
— fails the second immediately with `concurrent-nested-transaction`,
before any savepoint statement is sent and before its callback ever
runs: savepoints on one connection are strictly nested, so concurrent
siblings would interleave one `SAVEPOINT` sequence, silently discarding
one sibling's work or aborting the whole transaction depending on the
interleaving. Await one nested transaction before starting the next —
sequential nesting is unaffected.

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

## Aggregates and grouping

`count()`, `min`, `max`, `sum` and `avg`, with `groupBy`/`having` in
SQL's own clause order (`where` filters rows, `having` filters groups).
There is no `FILTER (WHERE …)` constructor yet — an earlier, invented
`countWhere(expr)` covered one use of it without generalizing to the
real clause, and was removed rather than kept (#469); a real `FILTER
(WHERE …)` construct is a tracked follow-up, not this version's
vocabulary (#501):

```ts prelude=query-handle
import { count, gt, max } from "hejbro";

const perStatus = await handle
	.select({ status: posts.status, orders: count(), biggest: max(posts.amount) }, posts)
	.groupBy(posts.status)
	.having(gt(count(), 1))
	.orderBy(posts.status)
	.limit(10);
```

What each reads back as:

| aggregate | type | why |
|---|---|---|
| `count()` | `bigint` | Postgres's `count` is `int8` whatever it counted, and hejbro converts it — the value really is a `bigint`, not the text the driver hands back |
| `min(x)` / `max(x)` | `x`'s own declared type | they return their argument's type, so a `bigint({mode:"number"})` column stays `number` |
| `sum(x)` / `avg(x)` | `number \| bigint \| string` | Postgres promotes these by the argument's *exact* type (`sum(int4)` is `int8`, `sum(int8)` is `numeric`, `avg(int)` is `numeric`, `avg(float8)` is `float8`), so one declared result type would be wrong for most inputs. Narrow it yourself with a cast in a `sql` fragment when you need to |

`min`/`max` read back as their argument's type but are **expressions**,
not column references: `min(posts.amount)` cannot stand in for
`posts.amount` itself anywhere a declaration API requires a real column
(an index's `.on(...)`, a foreign key's `columns`) — that fails to
type-check now, rather than compiling and failing wrong later.

`having` is available only after `groupBy`, and `groupBy` only after
`where` — the chain allows what SQL allows, in the order SQL allows it.

## Window functions

`over(target, spec)` attaches a window specification (`partitionBy`/
`orderBy`) to either an existing aggregate (`count()`, `sum(x)`, `min(x)`,
`max(x)`, `avg(x)`) or one of the window-only constructors: `rowNumber()`,
`rank()`, `denseRank()`, `percentRank()`, `cumeDist()`, `ntile(buckets)`,
`lag(x, offset?, default?)`, `lead(x, offset?, default?)`,
`firstValue(x)`, `lastValue(x)`, `nthValue(x, n)`. A window-only call has
no meaning on its own — it doesn't type-check anywhere an expression is
expected until `over()` wraps it. `spec.orderBy` takes the identical
`asc(...)`/`desc(...)`/nulls-placement vocabulary a select's own
`orderBy` does — see "The chain surface" above — not a separate spelling.

```ts prelude=query-handle
import { lag, over, rowNumber, sum } from "hejbro";

const withRunningTotal = await handle
	.select(
		{
			status: posts.status,
			amount: posts.amount,
			position: over(rowNumber(), {
				partitionBy: [posts.status],
				orderBy: [posts.publishedAt],
			}),
			running: over(sum(posts.amount), {
				partitionBy: [posts.status],
				orderBy: [posts.publishedAt],
			}),
			previous: over(lag(posts.amount), {
				partitionBy: [posts.status],
				orderBy: [posts.publishedAt],
			}),
		},
		posts,
	)
	.orderBy(posts.status, posts.publishedAt);
```

What each window function reads back as:

| function | type | why |
|---|---|---|
| `rowNumber()` / `rank()` / `denseRank()` | `bigint` | Postgres's own return type is `int8`, converted like `count()` above |
| `percentRank()` / `cumeDist()` | `number` | `float8`, arrives already as a JS number, no conversion needed |
| `ntile(buckets)` | `number` | `int4`, same reasoning |
| `lag(x)` / `lead(x)` / `firstValue(x)` / `lastValue(x)` / `nthValue(x, n)` | `x`'s own declared type | they return their argument's type unchanged, exactly like `min`/`max` above |
| `count()` wrapped in `over(...)` | `bigint` | same conversion as plain `count()` — `over()` only adds a window clause |
| `sum(x)` / `avg(x)` wrapped in `over(...)` | `number \| bigint \| string` | **exactly the same as plain `sum`/`avg` above, conversion included** — Postgres's promotion rule depends on the argument's exact type, not on whether a window clause is attached, so a windowed running total over a `bigint` column arrives as the *text* Postgres sends for `numeric` (e.g. `"35"`), not a `bigint`. This is easy to mistake for a bug the first time a running total prints a string instead of a number; it isn't one — narrow it yourself with a cast in a `sql` fragment when you need to, same as the plain form |

`where`/`groupBy`/`having`, an aggregate's own argument, and the six
declaration sites that store an expression (a column default, a generated
column, an index expression or predicate, a check constraint, an RLS
policy) all reject a window function with a build-time diagnostic —
Postgres itself refuses most of these placements, and hejbro never leaves
the rest to the raw driver error. `distinctOn` does **not** reject a
window function — Postgres itself accepts one there, so hejbro does too.

Window functions render under Postgres's own default frame (`RANGE
BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`) — frame clauses (`ROWS`/
`RANGE`/`GROUPS`) aren't modeled yet (#416). Two consequences are worth
knowing rather than discovering, both verified live against postgres:17
rather than asserted from the docs alone: under that default frame,
`lastValue` returns the *current* row's value, not the partition's last
row (the frame's upper bound tracks the current row); `nthValue(x, n)`
instead returns `null` until the frame grows to contain `n` rows, then
returns row `n`'s value and stays frozen there for every later row in
the partition — Postgres's own documentation calls both of these "not so
useful" without an explicit frame.

## Startup schema assertion

`assertSchema(handle, options?)` (imported from `hejbro`, `#302`) checks
that the database `handle.driver` is actually connected to matches every
declaration `handle.schema` exports — the same comparison `hejbro check`
runs from the CLI, callable from application code at startup instead. It
is opt-in and explicit: constructing a `db()` handle never connects or
reads anything on its own, and `assertSchema` is the only thing in this
capability that ever does. A real `db()` handle's own `.schema`/`.driver`
fields already satisfy `AssertSchemaHandle` structurally — pass the
handle itself, not a copy:

```ts prelude=query-handle
import { assertSchema } from "hejbro";

// resolves to a report on success -- never throws for a clean match
const report = await assertSchema(handle);
// report.compared: every declared identity assertSchema actually
// compared against the live catalog (e.g. "app.posts")
// report.notCompared: identities it could not compare, each with a
// `reason` (and a `code` only when that gap is itself a failure --
// see "Errors" below)
```

Six exported types carry this surface: `AssertSchemaHandle` (`{schema,
driver}`, the minimal structural slice of a `db()` handle this needs),
`AssertSchemaOptions` (`{registry?, allowNotCompared?}`),
`AssertSchemaEntry` (`{identity}`, one compared declaration),
`AssertSchemaNotComparedEntry` (`AssertSchemaEntry` plus `reason` and an
optional `code`), `AssertSchemaReport` (`{compared, notCompared}`, what
a successful call resolves to), and `AssertSchemaFinding` (`{identity,
error}`, one entry of the `findings` array an `assert-schema-diverged`
throw carries — see "Errors" below). `AssertSchemaFinding` is a type
alias, not a copy: it is structurally the same shape `hejbro check`'s
own comparison already produces, named under this surface's own
vocabulary because a type never published before takes the name of the
surface that first publishes it, not the command's.

**Catch by `code`, never by the error's class.** A thrown error's class
is not part of this function's contract — only `.code` is (the same
rule the query layer's own errors follow, "Errors" below). `assertSchema`
throws two different shapes for two different reasons, and a caller that
branches on `code` sees both alike:

- **Propagated**, class and message untouched, no `cause` added: a
  declaration no registered kind owns at all — `generateMigration`'s own
  `unowned-declaration` `HejbroError` — surfaces before the catalog is
  ever read. This already speaks this caller's own vocabulary (a
  declaration-time failure any `db()` caller could hit), so nothing
  about it is rewrapped.
- **Translated** into this library's own plain-`Error` `{code, cause?}`
  runtime shape: everything `assertSchema` itself decides. A `hejbro
  check`-vocabulary refusal it hits along the way (a `check-`-prefixed
  code — names something `hejbro check`'s own internals invoke, never
  this caller) is repackaged with the original preserved on `cause`,
  never left as-is.

```ts prelude=query-handle
import { assertSchema } from "hejbro";

try {
	await assertSchema(handle);
} catch (error) {
	// every failure this function raises carries `code` regardless of
	// its class -- this is the one stable thing to branch on
	const code = (error as { readonly code?: unknown }).code;
	if (code === "assert-schema-diverged") {
		// at least one compared declaration doesn't match the database
	}
}
```

### Errors

| `code` | When |
|---|---|
| `assert-schema-diverged` | At least one compared declaration doesn't match the live catalog — the message lists each diverging finding, quoted verbatim from the same comparison `hejbro check` uses (a quoted line may itself say to rerun that command; that instruction belongs to the quote, not to this call). The same findings are also attached as `findings: ReadonlyArray<AssertSchemaFinding>` on the thrown error, for a caller that wants the structured per-object data rather than parsing the message. |
| `assert-schema-not-compared` | At least one declaration should have been compared and couldn't (a registered kind with no comparator), or the schema module declares nothing at all — `options.registry` (for the former) or actual declarations (for the latter) are the fix; `options.allowNotCompared: true` opts out of failing on this specific cause without silencing a real divergence. A kind that states none of its objects is ever comparable (e.g. a kind with no catalog-visible equivalent) never triggers this on its own — only a comparison that *should* have run and could not does. |
| `assert-schema-catalog-unreadable` | Reading the database catalog itself failed (e.g. the connected role can't read `pg_catalog`) — the underlying failure is on `cause`. |

`unowned-declaration` (propagated, not translated — see above) can also
surface, unchanged, before either of these is ever reached.

## Not supported in this version

These read naturally as query-builder features but aren't there yet —
use the `sql` escape hatch, or wait for the tracked issue:

- `@hejbro/neon` and `@hejbro/nile` presets (#300, #301) — only
  `@hejbro/pg` (vanilla) and `@hejbro/supabase` exist today.
- Prepared-statement caching (#303) — every execution compiles and sends
  fresh. Measured, not shipped: a session-scoped named prepared
  statement's improvement over today's unnamed text query could not be
  shown, under a spread-estimator-invariant standard, to reliably exceed
  run-to-run measurement noise on the workload and machine measured
  (`openspec/changes/archive/2026-08-31-extend-query-runtime/measurement.md`)
  — the decision is scoped to that evidence, not a general claim about
  prepared statements.

## Errors

Every query-layer error is a plain `Error` carrying a `code` field and,
where relevant, a `cause` — never a thrown string, never a swallowed or
retried failure. The message always ends in a `Next:` sentence naming the
concrete next step.

| `code` | When |
|---|---|
| `query-execution-failed` | The driver rejected an executed statement (e.g. a constraint violation) — the message leads with the driver's own message (a cause with no usable message is named as such), followed by the parameterized SQL text. The query layer itself never writes the statement's parameter *values* onto the error — the SQL stays parameterized; text the database echoes inside its own error message or fields is the database's report, carried faithfully. |
| `result-conversion-failed` | A returned column's value couldn't convert to its declared type (an unconvertible/missing column, an array arrival-shape mismatch, or a `NULL` element under `.notNullElements()`). |
| `driver-missing-capability` | An operation (a transaction, a `db.as` context) needs a capability the active driver doesn't declare `true` — a capability explicitly declared `false` fails exactly like an undeclared one, never attempted. The capability set itself is fixed and exhaustive: a driver's own declaration must name every one of them, and omitting one, or naming one outside the set, fails to type-check rather than defaulting silently — this is a compile-time guarantee, checked before this runtime error's own path is ever reached. |
| `nested-transaction-unsupported` | The db handle's `transaction()` was called again from inside its own already-open callback — nest with `tx.transaction(...)` instead. |
| `concurrent-nested-transaction` | A second nested transaction was started on the same `tx` while the first was still in flight — await one before starting the next. |
| `savepoint-release-failed` | A nested transaction's callback returned normally, but its `RELEASE SAVEPOINT` failed (a statement error was swallowed inside the callback instead of rethrown, leaving the subtransaction aborted) — the release failure is on `cause`. |
| `savepoint-rollback-failed` | A `ROLLBACK TO SAVEPOINT` itself failed. Its trigger differs by path, so the fact that triggered it lands on a differently-named property: after a callback threw, on `callbackError`; while recovering from a failing release (above), on `releaseError`. The rollback failure itself is always on `cause`. |
| `undeclared-role` | `db.as({ role, ... })`'s role isn't in the declared whitelist. |
| `claims-subject-missing` | `@hejbro/supabase`'s `asUser(claims)` was called without a `sub` claim. |

Writing your own `Driver` (a custom preset, or wrapping a client library
`@hejbro/pg`/`@hejbro/supabase`/`@hejbro/neon` don't cover)? A member
that can't honor a declared-`false` capability constructs
`driver-missing-capability` by calling `@hejbro/query`'s exported
`throwMissingCapability(capability, operation)` — never by reproducing
its message text, so every driver's refusal reads identically:

```ts
import type { Driver } from "@hejbro/query";
import { throwMissingCapability } from "@hejbro/query";

const yourDriver: Pick<Driver, "transaction"> = {
	// declares `"interactive-transactions": false` in `capabilities`
	transaction: async () => {
		throwMissingCapability("interactive-transactions", "transaction");
	},
};
```

## Where this is enforced

- Specs: `openspec/specs/query-builder/spec.md` (chain surface, `sql`
  escape hatch, injection safety, column-explicit rendering, `with`/
  `withCte`'s entry/recursive-entry scenarios),
  `openspec/specs/query-execution/spec.md` (execution, error
  propagation, nested transactions, result conversion, a `WITH`
  statement's own execution path, declaration retention, and
  `assertSchema`'s own scenarios — folded in by the
  `extend-query-runtime` archive),
  `openspec/specs/query-type-inference/spec.md` (the recursive term's
  union-compatibility check against the anchor),
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
  `driver-missing-capability`, the exported `throwMissingCapability`),
  `packages/query/src/db/convert.ts` (`.notNullElements()` NULL
  fail-fast, and its own CTE column-state resolution),
  `packages/core/src/query/with.ts` (`withCte`, `w.as`, `w.asRecursive`,
  the union-compatibility poison on the recursive term),
  `packages/core/src/query/with-recursive.ts` (the recursive branch's
  narrowed `union`/`unionAll`-only combinator surface),
  `packages/core/src/expr/render-sql.ts` (`renderWith`, the
  self-visibility widening `recursive: true` gives an entry),
  `packages/query/src/db/chain.ts` (`handle.with`, mirroring
  `withCte`'s own callback), `packages/pg/src/driver.ts` (`pgDriver`),
  `packages/supabase/src/context.ts` (`asUser`/`asAnon`,
  `claims-subject-missing`), `packages/supabase/src/driver.ts`
  (`supabaseDriver`), `packages/core/src/types/assert-no-nulls.ts`
  (`assertNoNulls`), `packages/cli/src/index.ts` (the `sql` shadow, lines
  23-24), `packages/cli/test/exports.test.ts` (the shadow pinned by test,
  lines 38-50 and 52-69; `AssertSchemaFinding`'s own presence on the
  public entry, type-pinned rather than runtime-probed since a type
  alias has no `typeof` to check),
  `packages/cli/src/assert-schema.ts` (`assertSchema`, the six exported
  types, the three `assert-schema-*` codes, the propagate/translate
  split).
- Tests: `packages/cli/test/assert-schema.test.ts` (surface, causes
  ⓑ/ⓒ, the propagate/translate split, registry defaulting),
  `packages/cli/test/assert-schema-imports.test.ts` (this module never
  reaches filesystem/process/network internals -- a real handle's caller
  may run in contexts that forbid them),
  `packages/cli/test/assert-schema-live.integration.test.ts` (the one
  place `assertSchema` runs its real `readCatalog` path against a live
  postgres:17, Docker-gated, local-only).
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; every `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
