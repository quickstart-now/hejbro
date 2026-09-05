# Design: add-batched-transactions

Settled by the lead under the owner's full delegation for this pass
(412/D24, D25); recorded as R1 on #486 for ratification.

## Q1 — A capability, or a fallback inside the HTTP driver

- (i) The HTTP driver implements `transaction(callback)` by buffering.
- (ii) A named capability and a `batch` member on the contract.
- **Ruling (ii).** A callback cannot be buffered: its body reads prior
  results. Faking it would either run the callback twice or run it
  outside the transaction — the "attempt it anyway" the capability set
  exists to forbid. The ability Neon has is a *different* ability, and
  D95 says the set stays truthful by naming what a driver can do, not
  by widening what an existing key means.

## Q2 — Who chooses the path

The driver's declaration, at construction; never the caller and never
a probe. Interactive wins when both are declared (a driver that has a
session gains nothing from a batch), batched serves when interactive is
`false`, and neither is the missing-capability error naming both keys.
The two paths send the same statements in the same order — the
rendering (`ContextRendering`, built-in or contributed) is the single
source — so a preset's context semantics cannot diverge between paths.

## Q3 — The `batch` member's shape

`batch(statements: ReadonlyArray<CompileResult>): Promise<ReadonlyArray<
ReadonlyArray<DriverRow>>>` — one result list per member, in order.
Required on `Driver` like `transaction`; a `false` declaration
implements it by throwing the missing-capability error (the HTTP
driver's own `transaction` precedent), so the type stays flat and the
exhaustiveness check keeps its one shape. Atomicity is the driver's
obligation: the members run in one transaction, a failing member fails
the whole batch, and nothing of a failed batch is visible afterwards.
A driver without session state prepends its own pins inside the batch
(the HTTP driver already does).

## Q4 — What the batched path does not do

`db.as(context).transaction(callback)` and a provider handle's
`transaction` keep requiring interactive transactions. `fn` calls under
a context run as one batch each, like `execute`. Nothing else changes:
a plain `db.execute` on the HTTP driver never batches a context it does
not have.

## Q5 — Tier verification

The machine-verified obligation (driver-contract, "Every declared
tier's obligation is machine-verified") gains one leg: a driver
declaring batched transactions `true` is observed sending a context's
statements and the caller's statement as one batch, in order, with the
pins first where session state is `false`. The observation is taken on
the driver's own batch call, the only place a one-shot path's
transaction control is visible.
