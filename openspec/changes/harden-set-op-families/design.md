# Design: harden-set-op-families

Settled by the lead under the owner's full delegation for this pass
(412/D24, D25); recorded as R1 on #503 for ratification.

## Q1 — `"unknown"` is a wildcard

A `sql` fragment or an unplaceable literal resolves to family
`"unknown"`. Postgres types an untyped side against the other branch
at parse time, so a `text` anchor against a `sql` term is accepted
there; refusing it here would be stricter than the database (the
plpgsql-function-bodies precedent: hejbro never becomes stricter than
Postgres). `"unknown"` on either side matches every family.

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
`bigint`) is invisible at family granularity by construction. The
requirement states it in so many words so a reader never concludes
#489 is handled.
