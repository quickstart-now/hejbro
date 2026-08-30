# Design: extend-supabase-driver

## Measurement record

The proposal's claims about endpoint behavior rest on this measurement,
not on documentation. Recorded here so a reader can re-run it rather
than trust it.

### Environment

A local Supabase stack (`supabase start -x vector`) in a scratch project
outside this repository, with the pooler enabled for the duration of the
measurement and reverted afterwards (`[db.pooler] enabled` is `false` by
default and the default was restored).

- Direct Postgres (session-mode): host port `54322`
- Supavisor (`pool_mode = "transaction"`): host port `54329`, container
  port `6543`, `default_pool_size = 20`

The pooler requires a **tenant-qualified user name** — `postgres.<external_id>`
— because Supavisor routes by tenant. The `external_id` is per instance
and is read from the `_supavisor.tenants` table in the `_supabase`
database; it is deliberately not written down here, because a copied
value would be wrong on the next stack.

Saturation, where used below, means ~30 parallel clients each holding a
transaction open (`begin; select pg_sleep(5); commit;`) against a pool
sized 20.

### Methodology note that changed the result

The first attempt pinned `IntervalStyle` to `'postgres'` — which is the
server's own default. A setting that is lost then reverts to the same
value it was set to, so the measurement reports success whether or not
the setting survived: a false negative by construction. Every result
below uses `'postgres_verbose'`, a non-default value, so that loss is
observable. Without this correction the measurement would have concluded
that nothing breaks.

### M1 — a session-level `SET` across statements

```sql
select pg_backend_pid();          -- before
set intervalstyle to 'postgres_verbose';
select pg_backend_pid();          -- after the SET
show intervalstyle;
```

Under saturation, one run of three:

```
pid before SET:  245
SET
pid after SET:   247
IntervalStyle:   postgres      <- reverted to the server default
```

The other two saturated runs, and five rounds without concurrency, kept
`postgres_verbose` with the backend pid unchanged throughout.

**Result.** The setting is lost exactly when the backend process
changes, and the backend changes only under saturation. The failure is
real and intermittent — never observed with the pid stable, never
observed to survive a pid change.

### M2 — `SET LOCAL` inside a transaction

```sql
select pg_backend_pid();                            -- before
begin;
  set local intervalstyle to 'postgres_verbose';
  select current_setting('intervalstyle');          -- inside
  select pg_backend_pid();                          -- inside
commit;
select current_setting('intervalstyle');            -- after commit
select pg_backend_pid();                            -- after commit
```

Four runs (one idle, three saturated), identical pattern:

```
inside transaction:  postgres_verbose,  pid == pid before
after commit:        postgres           (server default)
after commit:        pid may differ from the transaction's pid
```

**Result.** A transaction's statements always shared one backend, in
every run. Transaction-local settings applied and expired exactly as
their scope says, regardless of whether the backend changed afterwards.

### M3 — the context path's own statement sequence

The sequence `db.as(...)` emits, run through the pooler against a
fixture schema with an `auth.uid()`-keyed RLS policy and two rows:

```sql
begin;
  set local role "authenticated";
  select set_config('request.jwt.claims',
    '{"sub":"<uuid>","role":"authenticated"}', true);
  select auth.uid();
  select id, owner, body from "<fixture>"."posts";
commit;
select current_setting('request.jwt.claims', true);
select current_user;
```

Four runs (one idle, three saturated), identical:

```
auth.uid():          the subject from the claims
rows:                the owner's row only (the other row filtered)
after commit:        claims empty, current_user back to the login role
transaction pid:     constant within the transaction, every run
```

**Result.** The RLS context path works through the transaction-mode
pooler unchanged. This is why the change is scoped to session pins: the
context mechanism is transaction-local by construction and needs
nothing.

### What was not measured

Supavisor's internal pooling behavior beyond the above (at what
concurrency reassignment begins, how a backend is chosen), and the
session-mode pooler endpoint. Neither is asserted anywhere in this
change.

## The conformance kit's observation boundary

The repository's conformance kit judges a `session-state: false` driver
by where the caller's own statement lands: it must be last, with at
least one statement ahead of it, for one execution. That obligation was
written for a driver whose execution is a single round trip.

The pooler path's execution is a transaction: transaction control, then
the pins, then the caller's statement, then the commit. What the kit is
handed therefore depends on what the caller's own stub records, and this
change fixes that boundary explicitly rather than leaving it implicit:
**the observation covers the statements that pass through the driver
session — the pins and the caller's statement — and not the transaction
control the driver issues around them.**

This is a boundary, so it is stated as one and its cost is stated with
it. The kit checks ordering, not content; it cannot see that the pins
and the caller's statement share one transaction, which on this path is
the property that actually matters. That property is therefore fixed
directly in this package's own tests, and the kit's verdict is treated
as necessary rather than sufficient. The kit is not modified here — it
belongs to the query layer, and whether it should learn this tier
combination is a question for whoever owns it, with a third driver's
needs in view rather than this one's.

## Follow-up worth registering

A conformance-kit generalization: the `false` tier's obligation could
name the property instead of the position — "the settings and the
caller's statement are in the same transaction, or in the same round
trip where there is no transaction" — which would cover both the HTTP
one-shot shape and the pooled-transaction shape without either driver's
test choosing what to record. Recorded here as a suggestion; the kit's
owner decides whether the second shape is enough evidence to generalize
on, or whether a third one is needed first.

## Open contract details

Settled with the owner before implementation, and recorded here as they
are settled:

- The option's own shape and spelling on the factory, and what an
  unknown option value does.
- The exact capability declaration for the pooler path, written as a
  constant that names both keys explicitly, per the exhaustive-record
  rule.
- The pin statements' SQL text and order on this path, and whether they
  are one statement or two.
- What the replaced session-setup member does on this path, given that
  the vanilla driver still calls it once per checked-out client.
- Whether a single-statement execution's transaction is visible anywhere
  in an error message, and if so, in what words.
