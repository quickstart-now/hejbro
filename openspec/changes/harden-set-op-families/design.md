# Design: harden-set-op-families

Settled by the lead under the owner's full delegation for this pass
(412/D24, D25); recorded as R1 on #503 for ratification.

## Q1 — `"unknown"` is accepted because it is invisible here, not a confirmed wildcard (R13)

A `sql` fragment or an unplaceable literal resolves to family
`"unknown"` because the type layer cannot see what type the expression
has, not because the server is known to unify it with anything: an
untyped literal is resolved by Postgres against the other branch at
type resolution (whether the literal's own text parses as the resolved
type is a value-level question the server answers at execution,
`22P02`/`22007`), while a fragment the server types on its own
(`sql`1`` is `integer`) is compared there and may be refused (measured:
`sql`1`` against `text` is accepted here and refused on postgres:17
with `42804`, #977). Refusing `"unknown"` on the theory that the server
usually unifies it would still risk being stricter than the database in
the cases it does (the plpgsql-function-bodies precedent: hejbro never
becomes stricter than Postgres), so this rule accepts `"unknown"` on
either side and proves nothing more than that.

## Q2 — Which pairs are refused

Not "any two different families": Postgres unifies some pairs through
implicit casts. The rule refuses exactly the pairs the server refuses,
and that set is **measured** in task 1.1 on `postgres:17` for the ten
concrete families (eleven minus `"unknown"`) in both directions, then
vendored as a literal table the type test reads. The requirement's
sentence names the class, not the list, so the list can grow with a
measurement without a spec change; the test enumerates the matrix so a
family added to `sqlTypeFamilies` without a row fails.

## Q3 — Where the rule lives

In `SetOpResult` (core), which the chain re-exports and the recursive
term's compatibility test already consumes — one definition, three
surfaces, no new type. The order guard and the key-set test stay as
they are.

## Q4 — What this does not close

Within-family divergence (#489: `int` vs `bigint`, `numeric` vs
`bigint`) is invisible at family granularity by construction. The same
granularity also lets through the same-family pairs the server itself
refuses — an array against an array whose element types are themselves
a pair the server refuses (`text[]` against `integer[]`, `time[]`
against `timestamptz[]`; arrays unify exactly when their elements do),
an enum against `text`, `varchar`, `char`, or a different enum type, a
time-of-day type (`time`, `timetz`) against a date or timestamp type,
`json` against `jsonb`, `macaddr` against `inet` or `cidr` — measured
on postgres:17; they are tracked as #977, and this requirement states
the gap rather than closing it.

## The measurement (task 1.1)

Server: `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu`.

Protocol: every probe is `union all`, not `union` — `union` needs an
equality operator on the unified type and `json` has none (`42883`),
which would read as a refusal unrelated to type unification. Each
probe records `pg_typeof` of the unified column, or the failing
statement's SQLSTATE.

Two SQLSTATEs count as refused, both failures of type resolution
before any row is read: `42804` when the two types' `typcategory`
differ, `42846` when they share a category but no cast unifies them.
No cell produced a value-level error (`22P02`); the measurement never
had to distinguish a bad literal from a refused pair.

The ten concrete-family representatives (R3-3): `uuid`, `text`,
`numeric`, `boolean`, `timestamptz` (datetime), `interval`, `jsonb`
(json), `bytea`, `inet` (net), `text[]` (array).

Results: all 90 cross-family cells are refused (84 × `42804`, 6 ×
`42846` — `uuid` against `json`, `uuid` against `bytea`, `json` against
`bytea`); no cross-family pair unifies; the matrix is symmetric. The
untyped literal unifies with all ten families in both directions and
takes the other side's type.

Homogeneity sweep: 25 concrete types × the 10 representatives (250
cells, one direction) — every type answers like its own family toward
every other family; `unified` appears only in the 20 own-family cells.

This section's own sweep tested each concrete type against only the ten
family representatives (one per family), which surfaces four
same-family refusals this way: `json` against `jsonb` (`42846`), `time`
or `timetz` against `timestamptz` (`42846`), `macaddr` against `inet`
(`42804`), an enum against `text` (`42804`). The array class stays
invisible here for a second, separate reason: the sweep's own concrete
type list carried a single array type (`text[]`) and never varied its
element type, so no two array types were ever probed against each
other. A wider review measurement — 30 concrete types against each
other, 900 ordered pairs, varying the array element type among them —
found the broader class the same way; the full list lives in #977, not
closed by this change.

Reproduction — a fresh `postgres:17` container, then the self-contained
SQL below (schema, three `values`-based probe sets, final dump):

```
docker run -d --name sf-pg -e POSTGRES_PASSWORD=postgres -p 55600:5432 postgres:17
docker exec sf-pg pg_isready -h 127.0.0.1 -U postgres -q   # loop until ready
docker exec -i sf-pg psql -U postgres -v ON_ERROR_STOP=1 -q < measure.sql
docker rm -f sf-pg
```

```sql
drop table if exists sf_probe cascade;
drop function if exists sf_probe_run(text, text, text, text, text);
drop type if exists sf_enum cascade;

create type sf_enum as enum ('a');

create table sf_probe (
	id serial primary key,
	probe_kind text not null,
	left_desc text not null,
	right_desc text not null,
	outcome text not null,
	detail text
);

create or replace function sf_probe_run(kind text, ldesc text, rdesc text, lexpr text, rexpr text) returns void
language plpgsql as $fn$
declare
	result_type text;
	v_state text;
	v_msg text;
begin
	execute format('select pg_typeof(c)::text from (select %s as c union all select %s) t limit 1', lexpr, rexpr) into result_type;
	insert into sf_probe (probe_kind, left_desc, right_desc, outcome, detail) values (kind, ldesc, rdesc, 'unified', result_type);
exception when others then
	get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
	insert into sf_probe (probe_kind, left_desc, right_desc, outcome, detail) values (kind, ldesc, rdesc, 'error:' || v_state, v_msg);
end;
$fn$;

\o /dev/null
-- The ten concrete-family representatives (R3-3).
with reps(family, typename, literal) as (
	values
		('uuid', 'uuid', '11111111-1111-1111-1111-111111111111'),
		('text', 'text', 'a'),
		('numeric', 'numeric', '1'),
		('boolean', 'boolean', 'true'),
		('datetime', 'timestamptz', '2020-01-01 00:00:00+00'),
		('interval', 'interval', '1 day'),
		('json', 'jsonb', '{}'),
		('bytea', 'bytea', '\x00'),
		('net', 'inet', '10.0.0.1'),
		('array', 'text[]', '{a}')
)
-- table1: the vendored 10x10 matrix, diagonal included.
select sf_probe_run(
	'table1', l.family, r.family,
	quote_literal(l.literal) || '::' || l.typename,
	quote_literal(r.literal) || '::' || r.typename
)
from reps l cross join reps r;

with reps(family, typename, literal) as (
	values
		('uuid', 'uuid', '11111111-1111-1111-1111-111111111111'),
		('text', 'text', 'a'),
		('numeric', 'numeric', '1'),
		('boolean', 'boolean', 'true'),
		('datetime', 'timestamptz', '2020-01-01 00:00:00+00'),
		('interval', 'interval', '1 day'),
		('json', 'jsonb', '{}'),
		('bytea', 'bytea', '\x00'),
		('net', 'inet', '10.0.0.1'),
		('array', 'text[]', '{a}')
)
-- table2: the untyped-literal wildcard, both directions (20 cells).
select sf_probe_run('table2', 'unknown', r.family, quote_literal(r.literal), quote_literal(r.literal) || '::' || r.typename)
from reps r
union all
select sf_probe_run('table2', r.family, 'unknown', quote_literal(r.literal) || '::' || r.typename, quote_literal(r.literal))
from reps r;

with reps(family, typename, literal) as (
	values
		('uuid', 'uuid', '11111111-1111-1111-1111-111111111111'),
		('text', 'text', 'a'),
		('numeric', 'numeric', '1'),
		('boolean', 'boolean', 'true'),
		('datetime', 'timestamptz', '2020-01-01 00:00:00+00'),
		('interval', 'interval', '1 day'),
		('json', 'jsonb', '{}'),
		('bytea', 'bytea', '\x00'),
		('net', 'inet', '10.0.0.1'),
		('array', 'text[]', '{a}')
),
sweep(sweepname, family, typename, literal) as (
	values
		('uuid', 'uuid', 'uuid', '11111111-1111-1111-1111-111111111111'),
		('text', 'text', 'text', 'a'),
		('varchar(10)', 'text', 'varchar(10)', 'a'),
		('char(1)', 'text', 'char(1)', 'a'),
		('sf_enum', 'text', 'sf_enum', 'a'),
		('smallint', 'numeric', 'smallint', '1'),
		('integer', 'numeric', 'integer', '1'),
		('bigint', 'numeric', 'bigint', '1'),
		('real', 'numeric', 'real', '1'),
		('double precision', 'numeric', 'double precision', '1'),
		('numeric', 'numeric', 'numeric', '1'),
		('boolean', 'boolean', 'boolean', 'true'),
		('date', 'datetime', 'date', '2020-01-01'),
		('time', 'datetime', 'time', '00:00:00'),
		('timetz', 'datetime', 'timetz', '00:00:00+00'),
		('timestamp', 'datetime', 'timestamp', '2020-01-01 00:00:00'),
		('timestamptz', 'datetime', 'timestamptz', '2020-01-01 00:00:00+00'),
		('interval', 'interval', 'interval', '1 day'),
		('json', 'json', 'json', '{}'),
		('jsonb', 'json', 'jsonb', '{}'),
		('bytea', 'bytea', 'bytea', '\x00'),
		('inet', 'net', 'inet', '10.0.0.1'),
		('cidr', 'net', 'cidr', '10.0.0.0/8'),
		('macaddr', 'net', 'macaddr', '08:00:2b:01:02:03'),
		('text[]', 'array', 'text[]', '{a}')
)
-- table3: the homogeneity sweep, one direction (25 x 10 = 250 cells).
select sf_probe_run(
	'table3', s.sweepname || ' [' || s.family || ']', r.family,
	quote_literal(s.literal) || '::' || s.typename,
	quote_literal(r.literal) || '::' || r.typename
)
from sweep s cross join reps r;

\o
\copy (select id, probe_kind, left_desc, right_desc, outcome, detail from sf_probe order by probe_kind, left_desc, right_desc, id) to stdout with csv header
```
