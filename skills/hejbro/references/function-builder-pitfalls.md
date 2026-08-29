# Function/trigger builder pitfalls

Read this when writing a `defineFunction`/`defineTrigger` body, or
debugging a `nondeterministic-body` error.

## The body callback runs twice

At declaration time (not at generate time), hejbro runs your body
callback twice and structurally compares the two recorded trees. This is
the determinism guard: it catches anything that isn't pure DSL recording
before it ever reaches SQL. `Math.random()`, `Date.now()`, and — most
commonly — real JavaScript `if`/`for`/`while` inside a body all diverge
between the two runs and throw `nondeterministic-body`.

```ts
import { defineTrigger, isNull, schema, table, uuid } from "hejbro";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	parentId: uuid(),
});

defineTrigger(
	comments,
	{ name: "comments_single_depth", timing: "before", events: ["insert"], forEach: "row" },
	(ctx, { new: row }) => {
		ctx.if(isNull(row.parentId), () => {
			ctx.return(row);
		});
	},
);
```

Never write `if (someCondition) { ... }` with a real JS condition inside a
body callback — the condition itself must be a hejbro `Expr<"boolean">`,
recorded via `ctx.if`, not evaluated in JS.

## The body context API

- `ctx.if(condition, then).elseIf(condition, then).else(then)` — an
  `IfChain`, fixed once built. `condition` accepts the same `Condition`
  union a query-side `where(...)` does — a `` sql`…` `` fragment reads as
  a body condition too, not just a typed `Expr<"boolean">`.
- `ctx.forEach(query, (row) => { ... })` — the only supported loop form.
- `ctx.row(query, name?)` / `ctx.rowOrNull(query, name?)` — reads one row
  into **one scalar local per projected column** (never a `record`
  variable); `row` is `select ... into strict` (errors on 0 or >1 rows),
  `rowOrNull` is a plain `select ... into` (fields are `null` on no row).
- `ctx.execute(statement)` — runs a select, insert, update or delete for
  its side effect, in body order: a select renders `perform <sql>;`
  (plpgsql rejects a bare `select` with no `into`), a mutation renders
  `<sql>;` as-is. A mutation ending in `.returning()` is refused
  (`execute-expects-no-returning`) — plpgsql's `perform`/bare form has no
  `into` clause to receive returned rows, so drop the `.returning()` to
  run it for effect, or pass it to `ctx.return(...)` when its rows are
  the result instead.
- `ctx.raise(message, ...args)` — `%` placeholders, one per arg.
- `ctx.return(value)` — **what it accepts is decided by the declaration's
  own `returns`, not by the value**, because plpgsql keeps the three
  return forms apart and rejects the wrong one (#424):
  | `returns` | `ctx.return(...)` takes | renders |
  |---|---|---|
  | a table (`returns setof …`) | a `.returning()`-final query or a select | `return query …;` |
  | the trigger sentinel (`defineTrigger`) | a trigger row (`new`/`old`) | `return new;` |
  | a scalar `TypeNode` | an expression — a column ref, an argument ref, a `` sql`…` `` fragment | `return <expr>;` |

  Passing the wrong shape fails at declaration time with a named error
  (`scalar-return-expects-expression`,
  `scalar-return-in-non-scalar-function`), and a scalar-returning body
  that never returns fails with `scalar-return-missing` — Postgres would
  otherwise accept the `CREATE` and raise "control reached end of function
  without RETURN" on the first call.

```ts
import { defineFunction, schema, sql, table, uuid } from "hejbro";

const shop = schema("shop");
const orders = table(shop, "orders", { id: uuid().primaryKey() });

// scalar: return an expression, never a query
export const orderCount = defineFunction(
	shop,
	"order_count",
	{ returns: { typeName: "bigint" } },
	(ctx) => {
		ctx.return(sql`(select count(${orders.id}) from "shop"."orders")`);
	},
);
```

## A builder you build is a builder you use

A select, insert, update or delete builder constructed while a body
callback runs must reach a consumer, or the declaration fails at
declaration time with `statement-builder-unused`, naming the statement
kind — never a silently smaller function than the one written. The rule
is *created and not consumed*, never "not returned": a chain's own
intermediate stages, `ctx.row`/`ctx.rowOrNull`/`ctx.forEach`/
`ctx.execute`, `exists`/`notExists`/`jsonArrayFrom`/`jsonObjectFrom`, a
set-operation combinator, and `defineView` (legal to call from inside a
body) all consume a builder that never reaches `ctx.return`.

```ts
import { defineTrigger, insert, schema, table, text, uuid } from "hejbro";

const app = schema("app");
const posts = table(app, "posts", { id: uuid().primaryKey() });
const auditLog = table(app, "audit_log", {
	id: uuid().primaryKey(),
	tableName: text().notNull(),
});

defineTrigger(
	posts,
	{ name: "audit_posts", timing: "after", events: ["update"], forEach: "row" },
	(ctx, { new: row }) => {
		// Built AND consumed, in the same statement — dropping the
		// ctx.execute(...) call here would fail the declaration instead of
		// silently generating a body that never writes the audit row.
		ctx.execute(insert(auditLog).values({ tableName: "posts" }));
		ctx.return(row);
	},
);
```

A builder made ahead of a choice keeps the choice, not the builder:
`ctx.return(flag ? update(t).set(v) : deleteFrom(t))` builds only the
branch that runs, so nothing goes unused. A set operation (`.union(...)`
and friends) has no body statement that accepts it on its own today — the
failure names that gap rather than pointing at `ctx.execute`, which
would send you to a call that rejects it too.

## Where to see it end to end

- API surface: `packages/core/src/plpgsql/body-context.ts`.
- A full trigger using `ctx.if` + `ctx.rowOrNull` + `ctx.raise`: the
  `comments_single_depth` trigger in `examples/postgres/src/app.schema.ts`
  (also pinned as the golden case `comments-single-depth` under
  `packages/core/test/golden/cases/`).
- A trigger whose body executes a statement (`ctx.execute`): the
  `auditTaskStatusChange` trigger in `examples/postgres/src/app.schema.ts`
  (also pinned as the golden case `audit-posts` under
  `packages/core/test/golden/cases/`).
