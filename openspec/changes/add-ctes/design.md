# Design notes: add-ctes

Measured facts this change is built on, kept here rather than in a
conversation so the tests in groups 6 and 7 have a source to check
themselves against. The approved D105 wording lands in this file too, when
group 7 writes it (task 7.5).

## The recursive-term restriction set is measured, not recalled

The PostgreSQL manual states **no** restriction list for a recursive term:
`queries-with.html` and `sql-select.html` were both read in full. The list
usually recalled — "no aggregates, no window functions, no `distinct`, no
`group by`" — was measured on `PostgreSQL 17.11` (Docker `postgres:17`)
and is **wrong on four counts**.

Fixture, a self-referencing tree `1 ← 2 ← 3`; a correct recursion returns
three rows:

```sql
create table t(id int primary key, parent int, v numeric);
insert into t values (1,null,10),(2,1,20),(3,2,30);
```

Each case was run as its own `psql` invocation with `VERBOSITY=verbose`.
Batching them misattributes results — stderr lags stdout, so a first
batched run tied errors to the wrong headers and every case was
re-measured individually.

### Refused

| Recursive term contains | SQLSTATE | Message |
|---|---|---|
| an aggregate at its own select level | `42P19` | `aggregate functions are not allowed in a recursive query's recursive term` |
| `order by` | `0A000` | `ORDER BY in a recursive query is not implemented` |
| `limit` | `0A000` | `LIMIT in a recursive query is not implemented` |
| `offset` | `0A000` | `OFFSET in a recursive query is not implemented` |
| self-reference on an outer join's **nullable** side (`t left join r`) | `42P19` | `recursive reference to query "r" must not appear within an outer join` |
| self-reference in the anchor term | `42P19` | `recursive reference to query "r" must not appear within its non-recursive term` |
| self-reference twice (`join r r1 … join r r2`) | `42P19` | `recursive reference to query "r" must not appear more than once` |
| self-reference inside a subquery (`where … in (select … from r)`) | `42P19` | `recursive reference to query "r" must not appear within a subquery` |
| `intersect` or `except` as the combinator | `42P19` | `recursive query "r" does not have the form non-recursive-term UNION [ALL] recursive-term` |

The two families mean different things — `42P19` is a recursion-structure
violation, `0A000` an unimplemented feature — so any diagnostic this
change writes keeps them as separate codes.

**Three boundaries inside that table, each measured, each able to turn a
guard into an over-rejection:**

- **The aggregate rule is about the recursive term's *own* select level.**
  An aggregate inside a scalar subquery there is **accepted**:
  `select t.id, (select sum(v) from t t2) from t join r on …` returns its
  three rows. A guard written with a deep walk would refuse it, and be
  wrong. The shallow boundary is the one `collectColumnRefs` already
  draws for `exists` — a subquery validates its own scope, so the walk
  does not descend.
- **Which error you get depends on what else is in the projection.** With
  a bare non-aggregated column and no `group by`, ordinary grouping
  validation fires *first* (`42803 column "t.id" must appear in the GROUP
  BY clause …`) and the recursion rule is never reached. The clean pin for
  `42P19` is a recursive term with **no** non-aggregated column and no
  `group by`: `select 1, sum(t.v) from t join r on …`.
- **The outer-join rule is about the self-reference's side, not about
  outer joins.** `t left join r` (self-reference nullable) is `42P19`;
  `r left join t` (self-reference non-nullable) is **accepted** — and does
  not terminate on its own, since the left join yields a row every
  iteration. Measured only with a depth guard (`where r.d < 5` → 6 rows).
  Postgres allows it, so this change does not refuse it; a witness that
  exercises it **must** carry a depth guard or a `statement_timeout`, or
  CI hangs.

### Accepted — the half that protects this change from itself

A window function, `distinct`, `distinct on`, `group by`/`having`, an
aggregate **in the anchor term**, `union` as well as `union all`, and both
`materialized` and `not materialized` on a recursive entry. All measured
returning the expected three rows.

The window case is the one that matters most. Under the recalled list this
change would have rejected a window function inside a recursive term — the
construct it exists to make usable, one room over:

```sql
with recursive r(id, v) as (
  select id, v from t where parent is null
  union all
  select t.id, row_number() over (order by t.id) from t join r on t.parent = r.id
) select * from r order by id;
--  id | v
--   1 | 10
--   2 |  1
--   3 |  1
```

`v` is `1` on the recursive rows because each iteration's working table
holds one row, so `row_number()` restarts. A test asserting only the row
*count* cannot tell "accepted and evaluated" from "accepted and ignored";
assert the values.

## The output column alias list is not a premise of recursion

Every recursive probe was first written as `with recursive r(id, v) as
(…)`, which left "does recursion require the alias list this change puts
out of scope?" as an unmeasured premise sitting between two approved
decisions. Measured: it does not.

```sql
with recursive r as (
  select id, v from t where parent is null
  union all
  select t.id, t.v + r.v from t join r on t.parent = r.id
) select * from r order by id;   -- 10, 30, 60
```

The names come from the anchor term's output, and the recursive term
resolves `r.v` against them — the running total proves the resolution is
real rather than positional. An anchor projecting explicit aliases
(`select t.id as node, t.v as val …`) names the CTE's columns `node` and
`val`, which is exactly the shape this builder emits: an object projection
always renders `expr as "alias"`. So the alias list is a convenience this
surface never needs.

The one shape where it would matter is unreachable from here: an anchor
column that is an unnamed expression (`select id, v * 2 …`) is named
`?column?` by Postgres — no error, just a useless name. This builder
cannot produce it, because an object projection always aliases and a
whole-table projection carries the column's own name.

### Carried caveats

- The `42P19` aggregate pin must avoid the `42803` shadow described
  above; use the `select 1, sum(…)` form.
- Deliberately unmeasured, and to stay that way: `SEARCH`/`CYCLE`,
  nesting beyond one level, and the alias list's interaction with the
  materialization hints. All three are out of scope, so measuring them
  would produce facts with no home.

## Why the join widening is cheap

Widening `SelectNode.from` alone stops **18** call sites compiling across
**7** files; widening `JoinNode.table` as well makes it **22** across the
same **7**. The four extra are each the join-side sibling of a call the
first widening already opens — `renderTableRef` in the joins loop,
`retargetJoin`, `encodeJoin`, and the preset validator's join collection —
so each reuses an answer written one argument over. Test-fixture churn is
zero for both: existing fixtures build table references, which stay
assignable to a widened union.

Measured on `34be0bd`. Every figure here is re-measured on the implemented
branch before it is quoted in a decision-log row (task 7.5).

**The implementation saw a different marginal count, and both numbers are
right.** Widening `JoinNode.table` *after* `from` was already a union and
its stopgaps were in place opened **6** sites across **5** files, not 4
across 4 — the probe measured both widenings in one step, so sites that
the probe attributed to `from` (`walk.ts`'s two join-scope spots among
them) fall to the join in a sequenced implementation. The claim the
decision rests on is unaffected and was confirmed: **no new file opens.**
Whichever number a decision-log row quotes, it names the baseline it was
measured against, because "+4" and "+6" are answers to two different
questions.

## A CTE reference escaping its `WITH`: runtime guard first, type-level is defense in depth

Task 1.3c closed a real gap: a `CteRefNode` rendered with nothing visible
(no enclosing `WITH`, or an `outerScope` that never names it) used to
render unqualified anyway, producing SQL naming a relation no `WITH`
declares — caught only by the server, not by the builder. The fix is a
runtime check in `render-sql.ts` (`assertCtesVisible`, gated on "are there
CTE targets to check", not on whether `outerScope` is defined).

The alternative — make the escape **unrepresentable** by typing the
reference object group 3's `with()` hands back so it cannot leave the
statement that declared it — was considered and set aside for *this*
change, not rejected outright. Once a value is a plain object a caller
can bind to a variable and pass anywhere, closing that off requires a
phantom token threaded through every position that could hold the
reference, and `add-window-functions` already measured this exact shape
and rejected it: a phantom brand is silent past **any** user-defined
helper the value crosses (a local `const pickSource = (r) => r`
type-checks and erases the brand), so the type-level guarantee reads
stronger than it is. That is worse than no guarantee if a reader takes
the type at its word.

So the runtime guard is the primary defense — it is what actually fires,
on every render, regardless of how the reference traveled to get there —
and a type-level constraint is defense in depth, added only as far as
group 3's own `[design]` tasks (3.1/3.2) can get one without the
silent-erasure failure mode. Group 3 does not need to re-litigate this
fork; the runtime guard already covers the case unconditionally.

## CTE visibility: one check, no new traversal (task 1.5(a) review)

`assertCtesVisible` (`render-sql.ts`) throws `undeclared-cte` when a
from/join target names a CTE outside `outerScope`'s own CTE markers. The
skip is gated on "are there any CTE targets to check" (task 1.3c), not on
whether `outerScope` is defined: a from/join list with no CTE reference
at all never reads `outerScope`, which is what keeps every existing
table-only render — bare or correlated — unaffected; a CTE reference with
an `undefined` or CTE-marker-less `outerScope` means literally nothing is
visible, which is exactly `undeclared-cte`'s own case, not a reason to
look away (rendering that select stand-alone would otherwise name a
relation no `WITH` ever declares, passing here only to fail on the server
with no diagnostic).

`renderWith` is the only producer of a scope carrying CTE markers, and
every render call already threads `outerScope` down through
`exists()`/`selectExpr()` (`renderExistsNode`/`renderSelectExprNode` pass
it straight through to their own nested `renderSelect`), so calling this
once inside `renderSelectClauses` — the one place every select's own
`from`/joins are assembled, top-level or nested — reaches a from/join
target buried inside a subquery too, with no separate traversal: a single
code covers task 1.3 (a name the statement never declares at all), task
1.4 (a name it declares, but not yet visible from here — `renderWith`
narrows `outerScope`'s markers to the earlier entries only when rendering
an entry), task 1.3b (a target inside a nested `exists()`/`selectExpr()`
subquery), and task 1.3c (a CTE reference rendered with no enclosing
`WITH` in sight at all — a reference object escaping the statement that
declared it, reachable once group 3 hands one out).

Not `foreign-column-ref`'s family: that family names a *column*
mismatched against a resolved table; this is a from/join target naming a
relation that either does not exist or is not visible yet, which needs
its own available-sources listing, not a "join that table" suggestion
that does not apply to a CTE.
