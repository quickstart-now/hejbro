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
   matters because a transaction-local setting issued outside a
   transaction block does nothing at all — it warns and is discarded.
   That last fact is **PostgreSQL's own documented behavior, cited here,
   not something this change measured**: the measurement record above
   covers the endpoint's session handling and nothing else, and this
   sentence is not one of its results. What follows from it is that the
   two orderings below are indistinguishable at the session surface and
   both pass the kit:

   | actually sent | recorded at the session surface | effect |
   |---|---|---|
   | `BEGIN` → pin → caller → `COMMIT` | `[pin, caller]` | pin applies |
   | pin → `BEGIN` → caller → `COMMIT` | `[pin, caller]` | pin discarded |

   The second row is precisely the failure this path exists to remove.

The kit's blind spot is not asserted from reading the kit alone — it was
demonstrated by mutating the implementation and watching which check
noticed. Two mutations, run in a detached worktree against the landed
code:

| mutation | envelope-level assertion (1.6) | conformance kit (1.7) |
|---|---|---|
| pins moved **after** the caller's statement | fails | fails |
| pins moved into a **transaction of their own** | fails | **passes** |

The second row is the one that earns the division of labor. A driver that
opens one transaction for its pins and another for the caller's statement
hands the kit `[pin, pin, caller]` — settings first, caller last, exactly
what the tier obligation asks for — while the pins apply to a transaction
that has already ended. That is the second failure the delta names
("never in a transaction of their own, where the endpoint's connection
reuse could separate them from the statement they cover"), and only the
envelope-level check sees it.

The first row matters too, in the other direction: it shows the kit is
not a rubber stamp. A pin that vanishes or moves after the caller's
statement is caught by the kit itself, which is what makes 1.7 a real
regression lock rather than a check that passes by construction.

Two corrections to what this section previously implied, both found in
review:

1. The **third** failure shape — pins sent *before* the transaction opens
   — is not reachable by mutating this decorator. The decorator only ever
   holds the session the wrapped driver's `transaction` hands it, so it
   has no way to send anything ahead of the opening statement. It stays
   in the delta as a property the specification forbids, but the mutation
   that demonstrates the division of labor is the separate-transaction
   one, not this one.
2. The test that asserts positions on a **hand-built** statement list is
   not a defense of the implementation — it stays green under every
   mutation above, because its subject is a literal, not the code. Its
   real value is different and worth keeping: it runs the kit against a
   capture the kit currently accepts, so the day the kit learns to see
   the envelope, that assertion goes red and tells us this division of
   labor needs revisiting. It is a tripwire on the kit's own repair
   (#528), not a guard on this driver.

## The wrapped driver's checkout pin (#531)

Measured in review, on the landed code, by building
`poolerDriver(pgDriver(pool))` over a stub pool that records every
`client.query` call, then calling `execute()` once and reading the
record. One `execute()` puts six statements on the wire, in this order.

```
1  set intervalstyle to 'postgres'; set bytea_output to 'hex'   <- the wrapped driver's session-scoped pin
2  BEGIN
3  set local intervalstyle to 'postgres'
4  set local bytea_output to 'hex'
5  <the caller's statement>
6  COMMIT
```

Statement 1 is the vanilla driver's own once-per-checkout pin, and it
still runs. The reason is one line —
`packages/pg/src/driver.ts:204`, `const ensurePinned = checkoutGuard(() =>
driver.setupSession)`: the *member* is read late, but the *object* it is
read from is captured, and it is the vanilla driver's own object. A
decorator that returns a new object — the shape every preset decorator in
this repository uses — is therefore never consulted, and replacing the
member on the decorated value cannot suppress the pin.

**This is not a claim that the vanilla driver is broken.** Its own
documentation describes the case it supports as a decorator that replaces
the member *after the factory returns* — that is, by assigning onto the
returned object, in place — and for that pattern the late-bound read
works exactly as documented. What this change uses is a different
pattern: build a new object from the old one. Both are "decorators" in
ordinary usage, and only one of them is covered.

The gap is therefore in the **contract's wording**, not in an
implementation. `driver-contract`'s requirement *Vanilla driver pins
IntervalStyle at checkout* says the hook is invoked "through the driver
value's own hook member — late-bound, so a decorator that replaces or
wraps that member takes effect on every subsequent checkout", and its
scenario *A wrapped session-setup hook takes effect at checkout* says the
same. Neither distinguishes assigning onto the driver value from building
a new value out of it, and the only preset decorators in this repository
— `supabaseDriver` and the pooler path's own, both in
`@hejbro/supabase` — do the latter. (The other preset builds its driver
objects outright rather than wrapping one, so it never meets this
question; the sample is small, and saying so is part of the evidence.) Whoever takes #531 decides which of the two the contract means —
narrowing the sentence, or making the vanilla driver resolve through the
value it hands back — but the starting point is a sentence that covers
one pattern while the repository's presets use the other.

This is recorded rather than fixed, for two reasons. It belongs to
another package, and this path's correctness does not rest on it: the
pins that matter are 3 and 4, inside the transaction that carries
statement 5. What statement 1 costs is one round trip per physical
checkout and a session setting left on a pooled backend — a state this
change stopped depending on, which is different from a state it removed.

This section is the evidence #531 points at, so it stays in this document
through archiving.

## Tasks that had no failing stage

Three of this change's twelve implementation tasks never went red, and
the record says so rather than implying a cycle that did not happen:

- **1.7** (the conformance-kit call) — the behavior it checks had already
  been built by the tasks before it.
- **2.2** (the one-argument call is unchanged) — a regression lock by
  construction; the behavior it pins is the behavior that existed before
  the change.
- **2.3** (contributed roles survive the pooler path) — the roles are
  applied after the spread, so the property held the moment the option
  dispatched at all.

None of the three is worthless: each is the lock that makes a later
change to this code fail loudly. But none is TDD either, and the reason
is visible in hindsight — a task whose subject is *"this existing
property still holds"* cannot start from a failing test unless the
property is deliberately broken first. That is a planning lesson, not an
implementation failure: such tasks should be written as regression locks
from the start, with their trigger named (what edit would make them
red), instead of carrying a red-first instruction they cannot honor.

2.5 is a fourth case with a different shape: it did have a failing stage,
but only under `tsc` (`TS2305`/`TS2724`), because the assertion is
type-level and vitest does not type-check. The same asymmetry exists in
the query package's own exports test, so it is a property of the
assertion's medium rather than of this task.

Both properties are therefore asserted directly in this package's tests,
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
