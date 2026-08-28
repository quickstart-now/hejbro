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
  `IfChain`, fixed once built.
- `ctx.forEach(query, (row) => { ... })` — the only supported loop form.
- `ctx.row(query, name?)` / `ctx.rowOrNull(query, name?)` — reads one row
  into **one scalar local per projected column** (never a `record`
  variable); `row` is `select ... into strict` (errors on 0 or >1 rows),
  `rowOrNull` is a plain `select ... into` (fields are `null` on no row).
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

## Where to see it end to end

- API surface: `packages/core/src/plpgsql/body-context.ts`.
- A full trigger using `ctx.if` + `ctx.rowOrNull` + `ctx.raise`: the
  `comments_single_depth` trigger in `examples/postgres/src/app.schema.ts`
  (also pinned as the golden case `comments-single-depth` under
  `packages/core/test/golden/cases/`).
