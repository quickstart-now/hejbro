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

### Carried caveats

- The aggregate case was measured with a `group by` in the same query.
  `group by` alone is accepted (measured separately), so the rejection is
  the aggregate's — but the pin is cleaner without the confound.
  Re-measure without it when writing the test.
- Only `t left join r` was measured. The reverse (`r left join t`, the
  self-reference on the non-nullable side) is **unmeasured**; the message
  suggests it may be legal, which is a reason not to assert either way
  until it is measured.
- Every recursive probe spelled the output column alias list (`r(id, v)`).
  Whether a recursive CTE works **without** one is unmeasured, and this
  change puts the alias list out of scope — so that is a premise the
  witness must establish, not assume.

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
