# Design: harden-aggregate-vocabulary

Open decisions, each as background → options → ruling. Settled by the
lead under the owner's full delegation for this pass and recorded as
rulings on the change's issue.

## Q1 — Where the vocabulary lives and how it is closed

**Background.** The cast side is in core (pure, type-level, no
`Declarations`); the revive side is in query and works over declared
tables. The two cannot share a function, but they can share data.

- (i) A table in core, exported from the barrel, keyed by a union of
  the builder function names, `satisfies Record<BuilderFunctionName,
  ReadShape>` — a constructor whose name is added to the union without
  a row fails `tsc`.
- (ii) Two lists kept in sync by a test only.
- **Ruling (i).** Type closure catches the omission where it is made;
  the runtime test (Q3) catches the string drifting from the row. The
  export follows the `SELECT_CLAUSE_TRAVERSALS` precedent: a public
  export whose tsdoc names it as the query layer's own contract, listed
  in the exports pin; not documented in the skill as user surface.

## Q2 — The shapes

`int8` (`count`, `row_number`, `rank`, `dense_rank`): cast `::text`,
revived as `bigint`. `argument` (`min`, `max`, `lag`, `lead`,
`first_value`, `last_value`, `nth_value`): cast by the first argument's
declared type exactly as a column reference is, revived by that
argument's state. `own` (`sum`, `avg`, `percent_rank`, `cume_dist`,
`ntile`): neither — Postgres promotes `sum`/`avg` by the argument's
exact type (a guessed conversion would be a lie), and the three
ranking-fraction/bucket functions return `double precision`/`integer`,
which JSON carries losslessly. A windowed node reads as its inner call
on both sides.

## Q3 — The ratchet

- The table-driven agreement test builds, for every row, a nested cell
  (unwindowed where the function allows it, windowed always) and asserts
  cast ⇔ revived from one execution: `own` rows are neither, every other
  row is both.
- A closure test lists every constructor the public barrel exports that
  produces a builder function node (aggregates and window functions),
  invokes each with a placeholder argument, reads the node's function
  name, and asserts the table has a row for it — the string-level half
  of the closure the type cannot see.
- The live witness runs `over(count(), …)` inside a nested read on a
  real server with a value past 2^53.

## Q4 — Not in scope

- `db.fn` (schema-qualified declared functions) stay outside: a
  schema-qualified `count` is a user's function, never the builder's.
- Casting `sum`/`avg` stays out (the argument-exact promotion argument
  above; the current requirement already says so).
