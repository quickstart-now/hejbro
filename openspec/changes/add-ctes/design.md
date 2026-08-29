# Design notes: add-ctes

## The approved D105 rows

Lead-approved 2026-08-29, to be transcribed **verbatim** into
`docs/specs/2026-08-19-hejbro-design.md` by task 7.5 — summary-table row
and decision-log row in **one commit**, as D103 and D104 did. That file is
owner-gated; this copy exists so the approved wording is diffable rather
than re-typed from a message.

**Re-verify before transcribing.** The row quotes four measured figures —
**13**, **10**, **3**, **0**. They were measured on the implemented tree
after `pnpm build --force`, through source-alias probes that never read
`dist`. If the branch was rebased after this approval, re-count first; if
any figure moved, the corrected wording goes back to the lead **before it
lands**, because the approval was of a specific claim, not of a
placeholder.

Summary-table row:

```
| D105 | CTEs: a `WithNode` statement variant plus a `FromNode` union, not a `SelectNode` side-channel | active |
```

Decision-log row:

```
| D105 | **A CTE lives in two places, both of them variants rather than fields: `WithNode` is a `QueryNode` variant carrying the entry list and a body, and a CTE reference reaches a statement through a `FromNode` union that `SelectNode.from` and `JoinNode.table` both widen into.** #299's parked fork (its own D5) asked where a non-table row source belongs, since `TableRefNode` renders hard-qualified and a CTE name has neither schema nor table. Measured on the implemented tree: adding a member to `FromNode` stops **13** call sites compiling across renderer, walker, retarget, column order, codec, result conversion and the Supabase RLS validator; adding a `QueryNode` variant stops **10**; the rejected `SelectNode.with` field stops **3** when required — all of them "you left a key out of an object literal", none of them a traversal site — and **0** when optional, which is the shape any real design would have picked. The security axis decided it: under the union, the preset validator that collects the tables a view reads **cannot compile** until it says whether a CTE body's tables count; under a field it compiles untouched while the case is reachable, so a view reading an RLS-guarded table inside a CTE would slip past the warning in silence. A sentinel schema on `TableRefNode` was rejected too — it makes unqualified rendering a runtime special case on a magic value rather than an arm the compiler demands. **Scope**: recursive CTEs are included (Postgres's grammar is `UNION [ALL | DISTINCT]`, not `union all` as #417's text said), `materialized` hints are included, and a view body may declare CTEs — refusing that would make the one-vocabulary promise false, the asymmetry D103 already rejected. **The named row environment strips `typeNode`/`sqlName` uniformly**, so a CTE column is structurally not a `ColumnRef` and cannot reach a foreign key target, a foreign key's local column list, or `.references()` at the type level; the three declaration sites that take an expression (index predicate, index column list, RLS policy) are unreachable that way and keep their runtime guards as the first line. **Recursive terms reuse set operations' `SameKeys` compatibility test** — the type moved into core so both layers can reach one rule — but **only the test**: a recursive CTE's column types come from its anchor, because Postgres refuses to widen there (`42804`) where a plain `UNION` widens. Known boundaries, each filed rather than left silent: #464 (an index's column list never checked column ownership), #487 (core's own `union()` carries no compatibility check), #489 (a recursive term whose column types resolve differently from the anchor type-checks here and fails on the server). **Snapshot**: `formatVersion` 8 unchanged — a new discriminator is vocabulary (D73) — and existing declarations serialize byte-identically, goldens included. (Decided 2026-08-29 under the owner's standing delegation, by the lead session; #299's parked fork was resolved on the terrain the sequencing built for it — set operations and window functions landed first — and is to be surfaced to the owner on return.) | a `SelectNode.with` side-channel (enforced by nothing: 3 key-filling errors when required, 0 when optional); a sentinel schema inside `TableRefNode` (magic value, runtime special case, and a live path for a table rename to rewrite an unrelated CTE); data-modifying CTEs (D94: mutations never reach a snapshot, so the node would split into a storable half and an unstorable one; Postgres also forbids recursive self-reference in them); the output column alias list (two sources of truth for one row's key names); `SEARCH`/`CYCLE`; forward references and mutual recursion (Postgres does not implement the latter) | One question, one answer: a CTE is a *kind of thing* the IR already knows how to enumerate, so the compiler can be made to ask about it everywhere — and the places it asks are the places where getting it wrong is silent |
```

**Barred from this row, deliberately.** The retracted `Omit`-drops-brands
claim (#476, closed — it did not reproduce). Task 5.2's parameter test as
evidence *against* the rejected field shape (it pins what the shipped
design guarantees; the unbuilt one was never measured). The
pre-implementation figures 18 and 22 (those measured the cost of widening
`from` while every consumer still assumed a table — the transition, not
the standing enforcement). And "a column's type is the union of the two
branches" — that sentence was wrong in a code comment and in the spec
delta, both fixed; the decision log was the third place it could have
landed, and the only one no later review would have caught.

---

The rest of this file is the measured facts the change is built on, kept
here rather than in a conversation so the tests have a source to check
themselves against — and so the row above could be written from them
rather than from a draft.

## The `Omit`-over-a-generic retraction

This section was going to be a probe recipe for #476 (a repo-wide sweep
that found the same shape at `expr/window.ts`'s `WindowFunctionCall` and
`expr/aggregate.ts`'s `Aggregated`) — until the defect it described
failed to reproduce and #476 was closed. What is worth keeping is not a
recipe for a defect that turned out not to exist, but the shape of the
mistake that produced it, so nobody reads the retracted claim out of the
git history and re-files it.

**What happened.** A "measured" type-system finding — `Omit` dropping
brands (`OriginBrand`, task 3.2's own row environment) when applied over
a generic type parameter rather than a concrete type — was reported up,
believed, and acted on: the lead swept the repository for the same
shape and filed it against two more sites. Independent review then
tried to reproduce it four separate ways and failed on all four, the
decisive one being the simplest: **restore the suspect `Omit` form,
revert the "fix", run the full gate suite — all green.** A test written
specifically to pin the defect also passed under both forms, because it
instantiated the generic with a concrete type argument at the call site
— which is exactly the case `Omit` handles correctly, not the case that
was under test.

**Root cause.** A stale `packages/core/dist/index.d.ts` — the original
investigation's own type probes were reading a built artifact that
lagged its source. The staleness was correctly diagnosed partway
through that investigation, but the diagnosis was never applied
backwards: the two findings made *before* the staleness was noticed
were reported as final without ever being re-derived against a clean
build.

**What actually held, checked four independent ways** (a `packages/core`
force-rebuild plus a source-alias re-probe; the revert-and-run-gates
check above; the mutation-style "does a genuinely broken form still
pass this test" check on the regression test itself; and a fresh,
from-scratch probe against the concrete case #476 named): `Omit` over a
**concrete** type keeps every key, optional `unique symbol` brands
included; `Omit` over a **generic type parameter** also keeps them, as
far as these four experiments could tell. There is no known case in
this codebase where it silently drops one.

**Two standing rules earned from this, kept because they generalize
past this one incident:**

- **A stale-artifact diagnosis invalidates every measurement taken
  before it.** Do not reason about which earlier findings the
  staleness could plausibly have affected — re-run all of them against
  a confirmed-clean build.
- **A test that stays green when you restore the suspect form is not a
  pin.** A regression test's own job is to fail under the bug it names;
  if reverting the fix doesn't turn it red, it was never testing that
  bug.

Where the fixed behavior's own regression tests live, for #476's
handler (or anyone else who reaches for this shape again) to reuse
directly rather than rediscover: `packages/core/test/query/with.test.ts`
(the row-environment case this retraction started from) and
`packages/core/test/query/with-recursive.test.ts` (the recursive-term
compatibility case, a different but adjacent generic-type-parameter
question, task 6.2).

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

## The two build-time diagnostics, and what the server actually does

`duplicate-cte-name` and `empty-with-list` were both measured on
postgres:17 — first by review when the gaps were found, then
independently during group 7 preparation. The two agree, and they behave
differently enough that a witness must treat them differently.

| SQL | SQLSTATE | Message |
|---|---|---|
| `with a as (select 1 as x), a as (select 2 as x) select * from a;` | `42712` | `WITH query name "a" specified more than once` (same under `recursive`) |
| `with select 1;` | `42601` | `syntax error at or near "select"` |
| `with a as () select * from a;` | `42601` | `syntax error at or near ")"` |

`42712` is a semantic check and its message is stable — assert both.
`42601` is a **parser** error and its message follows the next token —
assert the SQLSTATE only.

That parser detail also sharpens what `empty-with-list` is for. An empty
`WITH` is not a statement Postgres runs and rejects; it is text Postgres
cannot parse. So the diagnostic's justification is not "refuse first what
the server would refuse" but **"never emit text the server could not even
parse"**.

## The enforcement figures, measured after implementation

These are the numbers D105 quotes. They were taken on the implemented
tree, after `pnpm build --force`, through source-alias probes that never
read `dist` — the measurement method matters here, because this change
already retracted one "measured" claim that had been taken against a
stale `.d.ts`.

Method is D104's: add a dummy member and count what stops compiling.

| Probe | src errors | test churn |
|---|---|---|
| **F1** — a third member on `FromNode` (a new kind of row source) | **13** | 0 |
| **F2** — a new `QueryNode` variant (a new kind of statement) | **10** | 0 |
| **B1** — the rejected `SelectNode` field, required | **3** | 42 |
| **B2** — the rejected `SelectNode` field, optional | **0** | 0 |

F1's 13 are `render-sql` ×5, `walk` ×2, `retarget` ×2, `column-order`,
`codec`, `convert`, and the Supabase RLS validator — the last one being
the security axis this change argued the union for. F2's 10 match the
pre-implementation figure for the variant exactly. B1's 3 are still all
"you left a key out of an object literal", with **zero** traversal sites
among them; its fixture churn grew from 28 to 42 as the change added
tests that build `SelectNode` literals. The rejection argument is
stronger after implementation than before it.

**Do not quote the pre-implementation 18 / 22 here.** Those measured a
different thing — what it cost to *widen* `from` (and `JoinNode.table`)
while every consumer still assumed `TableRefNode`, i.e. the transition —
whereas F1 measures the standing enforcement the shape now provides.
A narrow-back probe (restoring the old types) is **not** a substitute
either: consumers now accept `FromNode`, so passing them the narrower
`TableRefNode` is contravariantly safe and most sites keep compiling.
It counts only the places that *construct or discriminate* a CTE
reference, and reading it as "this shape forced N sites" is wrong.

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
