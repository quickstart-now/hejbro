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
ctx.if(isNull(row.parentId), () => {
	ctx.return(row);
});
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
- `ctx.return(value)` — a trigger row (`new`/`old`) or a `.returning()`-final
  query.

## Where to see it end to end

- API surface: `packages/core/src/plpgsql/body-context.ts`.
- A full trigger using `ctx.if` + `ctx.rowOrNull` + `ctx.raise`: the
  `comments_single_depth` trigger in `examples/postgres/src/app.schema.ts`
  (also pinned as the golden case `comments-single-depth` under
  `packages/core/test/golden/cases/`).
