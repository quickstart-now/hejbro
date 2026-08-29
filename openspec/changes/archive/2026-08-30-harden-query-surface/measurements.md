# Measurements: harden-query-surface (group 1)

Batch run 2026-08-30, one sitting, against a locally spun-up
`postgres:17` container (`hqs-measure`, isolated from the parallel
team's `ne-pg` container). Container started:

```
docker run --rm -d --name hqs-measure -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust -p 5434:5432 postgres:17
```

Server version (measured, not assumed):

```
docker exec -i hqs-measure psql -U postgres -q -t -c "select version();"
```
```
PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
```

**Methodology note — a tool that lies by staying silent.** Found while
verifying container activity for this slice: `docker events` given an
**absolute** time (`--since 2026-08-29T15:13:10Z`) returns an empty
result without parsing it and without erroring. An empty result is
indistinguishable from "nothing happened", so it reads as evidence of
absence. It was caught only by a **positive control** — querying a
window in which containers were known to have started, and getting the
same empty output. Relative times (`--since 3h`) work. The rule this
generalizes to, and which applies to every row below: **a measurement
reporting "none" is not recorded until the same command has been shown
to report "some" under conditions where some is known to exist.** A
broken instrument's silence must never be submitted as a finding.

All queries below were run with:

```
docker exec -i hqs-measure psql -U postgres -q <<'SQL'
\set VERBOSITY verbose
<query>
SQL
```

Container torn down at the end of the batch with `docker stop
hqs-measure` (it was started with `--rm`, so stopping removed it).

---

## 1.1 M1 — aggregate in a recursive term

SQL run:

```sql
with recursive c(n) as (
  select 1
  union all
  select max(n) + 1 from c where n < 3
) select * from c;
```

Server output (verbatim):

```
ERROR:  42P19: aggregate functions are not allowed in a recursive query's recursive term
LINE 4:   select max(n) + 1 from c where n < 3
                 ^
LOCATION:  parseCheckAggregates, parse_agg.c:1299
```

Result: **refused**, SQLSTATE `42P19`. An aggregate in the recursive
term is not legal — the shipped spec's justification text claiming this
construct is legal does not describe a real construct, for aggregates.

## 1.1 M2 — window function in a recursive term

SQL run:

```sql
with recursive c(n) as (
  select 1
  union all
  select (row_number() over ())::int from c where n < 3
) select * from c;
```

Server output: **no error, no result within 120s.** The statement was
still `active` in `pg_stat_activity` after the harness's 120s timeout:

```
docker exec -i hqs-measure psql -U postgres -q -t -c "select pid, state, query from pg_stat_activity where datname='postgres' and query ilike '%row_number%';"
```
```
 100 | active | with recursive c(n) as (                                    +
     |        |   select 1                                                 +
     |        |   union all                                                +
     |        |   select (row_number() over ())::int from c where n < 3    +
     |        | ) select * from c;
```

Cancelled to end the run:

```
docker exec -i hqs-measure psql -U postgres -q -c "select pg_cancel_backend(100);"
```

The background statement then terminated with:

```
ERROR:  57014: canceling statement due to user request
LOCATION:  ProcessInterrupts, postgres.c:3426
```

Result: **not syntactically refused** (no parse-time error the way the
aggregate case gets one) — instead the query **never terminates**.
`row_number() over ()` with no `PARTITION BY`/ordering tied to the
recursion resets to `1` on every iteration of the recursive term, so
`n` never advances past `1` and the working table never empties. This
is a real construct in the sense that Postgres accepts it at parse
time, but it is not a construct that *completes*: it is not evidence
that "a window function in the recursive term is legal" in the
practically-useful sense the spec's justification text intends. This
measurement does not distinguish "window functions are categorically
fine in a recursive term" from "this particular window function
recurses forever" — a window expression whose value changes with the
recursion (not measured here) might terminate; that is out of this
batch's scope.

## 1.2 M3b-i — `numeric` anchor + `bigint` recursive term

SQL run:

```sql
with recursive c(v, i) as (
  select 1::numeric, 1
  union all
  select 2::bigint, i + 1 from c where i < 2
) select v, pg_typeof(v) from c;
```

Server output (verbatim):

```
 v | pg_typeof
---+-----------
 1 | numeric
 2 | numeric
(2 rows)
```

Result: **accepted**, column resolves to `numeric` (the anchor's type).

## 1.2 M3b-ii — `bigint` anchor + `numeric` recursive term (reversed)

SQL run:

```sql
with recursive c(v, i) as (
  select 1::bigint, 1
  union all
  select 2::numeric, i + 1 from c where i < 2
) select v, pg_typeof(v) from c;
```

Server output (verbatim):

```
ERROR:  42804: recursive query "c" column 1 has type bigint in non-recursive term but type numeric overall
LINE 2:   select 1::bigint, 1
                 ^
HINT:  Cast the output of the non-recursive term to the correct type.
LOCATION:  analyzeCTE, parse_cte.c:383
```

Result: **refused**, SQLSTATE `42804`. This matches the prediction (it
was inference from documented implicit casts, not measurement, until
now — measurement confirms it here). The pair (M3b-i accepted /
M3b-ii refused) is **directional, not symmetric**: swapping which side
is the anchor changes the outcome for the identical type pair
(`numeric`/`bigint`). A rule keyed on the unordered type pair would be
wrong by construction; the rule must key on the anchor's type winning
and the recursive term's resolved type having to match it exactly,
not on Postgres's ordinary (symmetric) implicit-cast resolution.

## 1.3 M4 — nullability-only divergence

**Citation scope — read before quoting this row or its addendum.**
Neither query below contains a `NOT NULL` constraint anywhere: both
anchors are literals (`select 1::int, 1` / `select 1, 1`), so there was
no server-side nullability for Postgres to disregard. What these rows
support is therefore **"Postgres's type resolution has no nullability
dimension at all, so a null produced by the recursive term reaches the
result rows unimpeded"** — not the stronger and unmeasured claim that
"Postgres ignores a `NOT NULL` anchor". The two reach the same
conclusion for group 6.1's purposes (our inference side is where
non-nullness is asserted, and it is asserted wrongly), but only the
first is quotable from this evidence. A faithful analogue with a real
`NOT NULL` column was identified and deliberately **not** run: the
batch had ended and the Docker slot had passed to the parallel team, and
re-taking a scheduling round to restate a conclusion already supported
is not a trade worth making. Recorded here so the omission is a
decision, not a hole.

SQL run:

```sql
with recursive c(v, i) as (
  select 1::int, 1
  union all
  select null::int, i + 1 from c where i < 2
) select v, pg_typeof(v) from c;
```

Server output (verbatim):

```
 v | pg_typeof
---+-----------
 1 | integer
   | integer
(2 rows)
```

Result: **accepted**, type stays `integer` in both rows; the `null` in
the recursive term does not change `pg_typeof`. This settles that
group 6's rule may ignore nullability: a nullable recursive-term value
of the same base type as the anchor is not a type divergence.

### 1.3 addendum — does the recursive term's null actually arrive at a result row?

Added after the initial batch (same sitting continued): acceptance and
`pg_typeof` alone cannot see nullability, since both rows above report
`integer` regardless. This checks the row content directly.

SQL run:

```sql
with recursive c(v, i) as (
  select 1, 1
  union all
  select null::int, i + 1 from c where i < 3
) select i, v, v is null as v_is_null, pg_typeof(v) from c order by i;
```

Server output (verbatim):

```
 i | v | v_is_null | pg_typeof
---+---+-----------+-----------
 1 | 1 | f         | integer
 2 |   | t         | integer
 3 |   | t         | integer
(3 rows)
```

Result: **the null arrives.** Rows 2 and 3 have `v_is_null = t` — a
real `null` value reached the result set, while `pg_typeof` reports
`integer` throughout and gives no hint of it. This is the gap group
6.1 must account for: if the anchor's column type is inferred as
non-null (`number`, not `number | null`), the CTE's declared result
type is unsound the moment the recursive term can produce a null of
the same base type — the type system would tell the caller `v` is
never null while the server hands back rows where it is. Whatever 6.1
decides (narrow the inferred type to nullable, or refuse this
divergence at build time), it cannot decide by silence: this
measurement rules out "no gap, PG blocks nulls somewhere" as an
outcome.

## 1.4 M5 — `nulls first`/`nulls last` in three positions (raw SQL)

### Plain select order by

SQL run:

```sql
select x from (values (1),(null)) v(x) order by x desc nulls first;
```

Server output (verbatim):

```
 x
---

 1
(2 rows)
```

Result: **accepted**, and the placement is honored — `null` sorts
first under `desc nulls first`.

### Window `over (order by …)`

SQL run:

```sql
select x, row_number() over (order by x desc nulls last) from (values (1),(null)) v(x);
```

Server output (verbatim):

```
 x | row_number
---+------------
 1 |          1
   |          2
(2 rows)
```

Result: **accepted**, and the placement is honored — under `desc nulls
last`, `1` gets `row_number` 1 and `null` gets `row_number` 2 (null
sorted last).

### Set-operation whole-set order by

SQL run:

```sql
(select 1) union (select 2) order by 1 desc nulls last;
```

Server output (verbatim):

```
 ?column?
----------
        2
        1
(2 rows)
```

Result: **accepted syntactically** — `nulls last` is legal in this
position. Caveat: this particular data set (`1`, `2`) contains no
`null`, so this run does not exercise the actual placement behavior in
this position, only that the clause parses and executes without error.
No stronger claim than "legal in this position" should be drawn from
this row alone.

All three positions accept `nulls first`/`nulls last` — group 5's
scope is not narrowed by this measurement.

---

## Group 8 — set-operation branch order (review-run, postgres:17.11)

Run during review in a throw-away container (`qh-rev-cite`, removed
afterwards; `test:integration` was **not** run, so 7.7's closing slot is
untouched). These are what group 8's spec delta may cite.

- **The corruption**: same key set, different order, matching types →
  accepted, values cross. `email` comes back holding a city and `city`
  holding an email. Reproduced in a `create view` **and** in a bare
  `select`, so it is not a view-specific effect.
- **The control**: when the types also diverge, the server refuses —
  `ERROR: 42804`, "UNION types uuid and text cannot be matched".
  SQLSTATE captured with `\set VERBOSITY sqlstate`; the first run of
  this measurement caught only the message text and **not** the code,
  which would have left the delta citing a code nobody had measured.
  It is the **same** `42804` a mismatched recursive term raises — not a
  coincidence: both are union type-resolution failures.
- **All three operators corrupt, not just `union`**: `except` and
  `intersect` match by position too. `except` is the worst of them —
  `select email, city from a except select city, email from b` returns
  one plausible-looking row while actually comparing email against city,
  so nothing signals that the answer is wrong. `intersect` returns 0
  rows for the same reason.
- **Output column names come from the LEFT branch — measured, not
  assumed**: a view over `select a.email, a.city … union select b.city,
  b.email …` reports `email,city` in `information_schema.columns`, even
  though the right branch's first column is `city`. This is D103's
  naming rule confirmed on the server, and it is the property group 3's
  repair has to pin.

**Not measured — must not be cited** (a statement about what was not
run, not a claim that those paths are safe): the recursive-CTE path's
*server* behaviour under a reordered recursive term (only the TypeScript
side was checked there); chains of three or more branches; the `all`
variants (`unionAll`/`intersectAll`/`exceptAll`); any Postgres version
other than 17.11.

## M6 — do differently-named union branches execute? (review-run, postgres:17.11)

Run during review of 7.1 in a throw-away container (`qh-rev-m6`, removed
afterwards; `test:integration` not run). Measured **before** the closing
slot because 7.1's corrected set-operation justification cites it, and a
spec sentence must not rest on a forward citation.

Container:

```
docker run --rm -d --name qh-rev-m6 -e POSTGRES_PASSWORD=x -P postgres:17
```
```
PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu
```

SQL run:

```sql
create table a (email text not null, city text not null);
create table b (login text not null, town text not null);
insert into a values ('alice@x.com','Seoul');
insert into b values ('bob@y.com','Busan');
select a.email, a.city from a union select b.login, b.town from b;
```

Server output (verbatim):

```
    email    | city
-------------+-------
 alice@x.com | Seoul
 bob@y.com   | Busan
(2 rows)
```

Result: **accepted.** Every column name differs between the branches and
the statement still executes; the result takes the **left** branch's
names. Confirmed through a view as well:

```sql
create view m6v as select a.email, a.city from a union select b.login, b.town from b;
select string_agg(column_name, ',' order by ordinal_position)
  from information_schema.columns where table_name='m6v';
```
```
email,city
```

**Positive control** (that the instrument reports refusals at all):

```sql
select a.email from a union select 1 from b;
```
```
ERROR:  42804
```

So the acceptance above is a real acceptance, not the silence of a
broken check. Server version `PostgreSQL 17.11`.

**What this settles**: the shipped spec's claim that key-set mismatch is
refused because "the database would reject the statement" is **false** —
Postgres matches set-operation branches by position and type, never by
name. The rule stands on the TypeScript row type being name-keyed, which
is what 7.1's delta now says.

## Summary table

| ID | Construct | Result | SQLSTATE / type |
|----|-----------|--------|------------------|
| M1 | aggregate in recursive term | refused | `42P19` |
| M2 | window fn in recursive term | not refused, **non-terminating** | (cancelled, `57014`) |
| M3b-i | numeric anchor + bigint recursive | accepted | `numeric` |
| M3b-ii | bigint anchor + numeric recursive | refused | `42804` |
| M4 | nullability-only divergence | accepted | `integer` (unchanged) |
| M4 addendum | does the recursive term's null reach a result row | **yes** — `v_is_null = t` on rows 2–3 | `integer` (silent) |
| M5 (select) | nulls first/last | accepted, honored | — |
| M5 (window) | nulls first/last | accepted, honored | — |
| M5 (set-op) | nulls first/last | accepted syntactically (unexercised placement) | — |

## Correction: the pre-rebase file count of 38 (reviewer, measured)

During review the pre-rebase file count of 38 was reported as having
"never been true". That is wrong. The measurement window at the time was
eight late commits, all of which sat *after* the blackbox entry was
created. A census of all 45 pre-rebase commits shows:

- Exactly one commit has a branch-diff file count of 38 — `ab0fe8f`
  (*chore: refresh the crap readme badge*).
- The next commit, `ba48668` (*docs(openspec): add the
  harden-query-surface blackbox entry*), takes the count to 39 by
  bringing exactly one new path into the set,
  `blackbox/2026-08-29-harden-query-surface.md` (set difference: one
  entering, none leaving). That commit also modified `tasks.md`, but
  that file had been in the set since `357a01a`, so it does not move
  the count.

The 38 the implementer cited was therefore a **true value**. The error
was not the number but its **attribution** — it was reported as a
before/after-rebase difference, and the real boundary is before/after
the creation of the blackbox entry.

*(Measured with `git diff --name-only a3eb5f5..<commit>` across all 45
pre-rebase commits — the old base, matching the counts being corrected;
set differences with `LC_ALL=C sort` and `comm`.)*
