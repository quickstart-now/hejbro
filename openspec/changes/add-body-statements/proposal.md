# Proposal: add-body-statements

## Why

A plpgsql body can select, branch, raise, loop and return. It cannot
execute a statement for its side effect, so the most common trigger in
any application — write a row to an audit table — is not expressible
(#426). Worse, writing one anyway is silent: a builder constructed
inside a body and never handed to `ctx.return(...)` is discarded with no
diagnostic, and the generated function is a body that lost a statement
the user wrote (#423).

```ts
defineTrigger(app, "audit_posts", { on: posts, timing: "after", events: ["update"],
  body: (ctx) => {
    insert(auditLog).values({ tableName: "posts", changedAt: sql`now()` });
    ctx.return(ctx.new);
  }});
```

Today this generates `return new;` — one line, no warning. The insert is
gone. The determinism guard (D22) cannot see it: it compares two
recordings of the same body for structural equality, and both recordings
are equally empty.

The two defects are one problem seen from both ends, and neither is
fixable alone. A guard shipped without the vocabulary would reject the
insert above while naming no correct form to write instead — a diagnostic
whose `Next:` line has nothing to point at. The vocabulary shipped
without the guard adds a second way to build a statement and drop it, so
the silent-loss surface grows.

Separately, `defineFunction`'s `args` accepts column builders while
`returns` demands a raw `TypeNode` literal (#433) — the same asymmetry
already fixed once for this function's schema argument (#269).

## What Changes

- **`ctx.execute(<statement builder>)`** records a side-effect statement
  in body order. A select renders `perform <sql>;`, a mutation renders
  `<sql>;`. Postgres decides both spellings: "the only accepted way to do
  it is PERFORM. An SQL command that can return rows, such as SELECT,
  will be rejected as an error unless it has an INTO clause."
- **A mutation carrying `.returning()` is refused** by `ctx.execute`,
  because Postgres refuses it: a command that returns rows needs an INTO
  clause to consume them. This is hejbro relaying the database's rule,
  not adding one of its own — the distinction the spec text states
  explicitly, since a rejection hejbro invents would be out of bounds.
  The check is at runtime (`returning !== null`), not in the type: the
  returning stage's type is a *subtype* of the stage before it
  (`InsertReturnable = InsertFinal & { returning }`), so no signature can
  exclude it.
- **A builder created in a body and never consumed fails the
  declaration.** The rule is *created and not consumed*, not "not
  returned": a chain's intermediate stages, `ctx.row`/`ctx.rowOrNull`/
  `ctx.forEach`, `exists`/`notExists`/`jsonArrayFrom`/`jsonObjectFrom`,
  and the set-operation combinators all legitimately take a builder that
  never reaches `ctx.return`. Registration is gated on an open recording
  session, because `@hejbro/query`'s runtime chain calls the same core
  factories on every query and must never pay for, or trip over, the
  guard.
- **A trigger body that returns a query is refused.** The shape check
  fires only for scalar-returning declarations, so this case renders
  `return query …` inside a `returns trigger` function and Postgres
  rejects the CREATE — the same failure the scalar case already prevents,
  found while mapping the return dispatch for this change.
- **`ctx.if`/`elseIf` take `Condition`**, the `Expr<"boolean"> |
  Expr<"unknown">` union the query-side condition positions already take
  since #386. That change deliberately left the body out to avoid
  colliding with this one; the owner's instruction on #426 is that
  whichever change lands here carries the widening.
- **`returns` accepts a column builder**, keeping the builder's own type
  as `TReturns` and resolving the result through `ColumnReadType` rather
  than reconstructing a `TypeNode` from `TMeta`. Nothing is normalized,
  so nothing is lost: `varchar({ length })`'s length, an enum's
  identity, an array's element type stay exactly where they were, and
  `db.fn`'s typed return survives.
- **A declared numeric mode reaches the call.** `db.fn`'s scalar
  conversion currently derives the mode from the type node
  (`defaultNumericMode`) because the declaration never carried one. With
  a builder as `returns` that becomes a visible defect — a
  `bigint({ mode: "number" })` return would type as `number` and arrive
  as `bigint` — so the declaration carries `mode` (and `jsonType`) and
  the conversion reads it.
- **No snapshot change.** A function's snapshot stores `bodySql` +
  `bodyHash`, not the statement tree, and its `returns` is the rendered
  clause text, so a new `stmtKind` and a new in-memory declaration field
  need no codec entry and no `formatVersion` bump. Existing goldens do
  not move: the only real body in `examples/` uses `ctx.rowOrNull`,
  `ctx.if`, `ctx.raise` and `ctx.return(row)`, and consumes every builder
  it makes.

## Capabilities

### Modified Capabilities

- `plpgsql-function-bodies`: the body's *statement* vocabulary, alongside
  the return contract it already specifies — what a body may execute for
  effect, what happens to a builder it makes and does not use, what a
  condition position accepts, and the trigger case the return contract
  left open.
- `typed-function-execution`: that a builder-declared return keeps its
  type at the call, and that the declared numeric mode is the one the
  call materializes.

### New Capabilities

- `function-declaration`: what `defineFunction` accepts as a declaration
  — here, that `returns` takes a column builder like `args` does. No spec
  covers the function declaration surface: `table-declaration` is tables
  and columns, `plpgsql-function-bodies` is bodies, and
  `typed-function-execution` is the call. This change is the first to
  touch it, so it gets a spec covering exactly what is touched (D87).

## Impact

- **Affected code**: `packages/core` (`plpgsql/body-ast.ts`,
  `plpgsql/body-context.ts`, `plpgsql/render-body.ts`, a new
  `plpgsql/recording-session.ts`, `dsl/define-function.ts`, and a
  registration line at the builder factory sites in `query/mutate.ts` and
  `query/select.ts`), `packages/query` (`db/fn-types.ts`, `db/fn.ts`),
  `skills/hejbro` references.
- **Breaking**: a body that constructs a builder and uses it for nothing
  stops compiling. Every such body today loses that statement silently,
  so no working declaration changes behavior. `ctx.execute` and the
  `returns` builder form are additive.
- **Decision log**: no new row. §6.2's claim — the compiler knows in
  advance what Postgres will reject — is what both new rejections
  implement.

## Out of scope

- Arithmetic and string concatenation in the expression vocabulary
  (noted on #426 as related). A body that computes a value still drops to
  `sql`; that is a separate vocabulary and a separate change.
- `perform`-style calls of a declared function
  (`ctx.execute(db.fn.foo(...))`). `ctx.execute` takes a statement
  builder; a function call is an expression, and admitting it means
  deciding how a declaration references another declaration's callable —
  bigger than this change.
- Reworking `recordReturnQuery`'s property-name probe into brand
  dispatch. The existing spec requires brand dispatch for the *trigger
  row*, which is where a user's own column name could collide; the query
  probe reads keys no table column can produce (`selectQuery`,
  `insertQuery`, …) and is left alone rather than half-migrated here.
