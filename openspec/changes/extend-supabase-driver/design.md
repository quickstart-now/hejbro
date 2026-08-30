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
handed therefore depends on what the caller's own fixture records, and
that is not left implicit here.

**Measured, before deciding.** A scratch fixture handed the kit a
capture of `["BEGIN", <pin>, <caller>, "COMMIT"]` with the caller's
statement named, under a `{interactive-transactions: true,
session-state: false}` declaration. The kit throws:

```
driver conformance violation (session-state:false): the caller's own
statement was not the last thing sent for this execution. Next: fix the
driver's session handling for this tier, or its capabilities declaration
if it doesn't actually belong in this tier.
```

The same capture narrowed to `[<pin>, <caller>]` passes.

**The boundary, and what argues for it.** The observation handed to the
kit covers the statements that pass through the driver session — the
pins and the caller's statement — and not the transaction control the
driver issues around them. Two facts put transaction control outside it,
and both are about the domain rather than about habit:

1. `BEGIN`/`COMMIT` are sent to the client library directly as bare
   strings. They are never built as a `CompileResult` and never cross
   the `execute` contract; they are the driver's own plumbing for
   holding a connection.
2. The kit's statement type is documented as carrying the same two
   fields a `CompileResult` carries onward to a driver. Transaction
   control is outside that type's stated domain.

**No shipped driver is a precedent for this, and claiming otherwise
would be wrong.** The vanilla driver is checked on the `true` tier,
whose observation is the setup hook by definition — the envelope
question cannot arise there. The other `false`-tier driver is captured
at its transport, and has no textual transaction control to exclude
because its batch form is protocol-level. The kit's own documentation
names those two fixtures as the model, and both read at the
transport/client level. This change is the first to draw the line at the
session surface, which makes it a **change to the documented model**,
not a restatement of it — and the price of that is paid below.

**What the narrowed observation stops showing, in full.** Two
properties, not one:

1. That the pins and the caller's statement reach the database inside
   **one transaction**. A pin in a different transaction is worthless
   and still satisfies the kit.
2. That the pins are sent **after** the transaction opens. This one is
   invisible to any session-level observation by construction, because
   `BEGIN` is not among the statements such an observation records. It
   matters because a transaction-local setting issued before `BEGIN`
   does nothing at all — it warns and is discarded — so the following
   two orderings are indistinguishable at the session surface and both
   pass the kit:

   | actually sent | recorded at the session surface | effect |
   |---|---|---|
   | `BEGIN` → pin → caller → `COMMIT` | `[pin, caller]` | pin applies |
   | pin → `BEGIN` → caller → `COMMIT` | `[pin, caller]` | pin discarded |

   The second row is precisely the failure this path exists to remove.

Both are therefore asserted directly in this package's own tests,
against a capture that **does** show the envelope, and the assertion is
positional: the pins follow the statement that opens the transaction and
precede the caller's own. This is the division of labor the boundary
buys — the kit checks order within the contract's surface, this package
checks the pins' position relative to the envelope — and stating it is
what keeps the narrowed observation a boundary rather than an evasion.

**A finding recorded, not acted on.** The specification describes this
tier's check as verifying that *some statement precedes* the caller's
own; the implementation additionally requires the caller's statement to
be *last*. The implementation is stricter than the requirement it
implements. Nothing here depends on which wins — the observation above
satisfies both — and the kit belongs to the query layer, so this is
reported rather than repaired inside this change.

## Follow-up: the conformance kit (#528)

Two items, both out of scope here and both tracked on #528:

1. **The kit is stricter than its own specification.** The requirement
   says a `false`-tier check verifies that some statement precedes the
   caller's own; the implementation requires the caller's statement to
   be last. Bringing the two together is a repair of specified behavior
   in either direction — relax the implementation, or tighten the
   requirement — and it should be decided once rather than worked around
   per driver.
2. **The obligation names a position where it means a property.** It
   could instead name the property: the settings and the caller's
   statement reach the database in the same transaction, or in the same
   round trip where there is no transaction. That covers the HTTP
   one-shot shape and the pooled-transaction shape at once, and it is
   the thing a `false`-tier driver actually has to guarantee — the
   position is only a proxy for it, and a proxy that a driver can
   satisfy while a pin sits in the wrong transaction.

The second shape now exists, so there is more evidence than when the kit
was written; whether two shapes are enough to generalize on, or a third
is wanted first, is the owner's call.

3. **The kit's own documentation names the wrong fixtures for a driver
   with an envelope.** Its tsdoc points a caller at the two existing
   stubs as the model, and both capture at the transport/client level.
   A future preset that follows that guidance for a driver that opens
   its own transaction will hand the kit a capture ending in `COMMIT`
   and hit the same misfire this change had to route around. The kit
   should say which domain the observation is taken from, rather than
   naming fixtures whose domain differs from each other's.

One ordering note belongs with them: this change makes the pooler path's
tests call the kit, so the day the kit's own tier check is tightened or
relaxed, this package is one of the callers that moves with it. The
repair is cheaper before a third driver arrives than after — and the
third driver is exactly who item 3 protects.

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
