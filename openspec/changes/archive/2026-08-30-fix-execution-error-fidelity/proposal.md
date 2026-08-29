# fix-execution-error-fidelity

## Why

When a statement fails, `query-execution-failed`'s `message` carries the
compiled SQL but not the driver's reason — the single most useful fact
about the failure lives one dereference away (`cause.message`), and every
default view (log pipelines, error trackers, `console.error(err.message)`)
shows the same message for every failure of a given statement (#427,
measured on dev @ b118bab: a duplicate-key violation's constraint name
appears nowhere in `message`).

## What changes

- `query-execution-failed`'s message SHALL lead with the driver's own
  message, before the parameterized SQL: the reason survives truncation;
  the SQL, which can be arbitrarily long, follows. A cause with no usable
  message is named as such rather than interpolated as `undefined`.
- The `Next:` line stops implying the reason is only on `cause`; `cause`
  remains the full driver error (fields like `detail`/`hint` included).
- The value-exposure guarantee is reworded to its true scope: **this
  layer** never writes parameter values onto the error (the SQL stays
  parameterized, the params array is never read). What the database
  echoes inside its own error text is the database's report, carried
  faithfully — the current absolute wording ("values appear nowhere on
  the error") is already unsatisfiable in the class where Postgres echoes
  a value in its primary message, since `cause` is on the error.

## Impact

- `packages/query/src/db/execute.ts` (message construction only; the
  wrapper still never retries or reinterprets).
- Spec delta: `query-execution` — one MODIFIED requirement.
- No new exports; error `code`/`kind`/`cause` fields unchanged.

## Approval

Decided 2026-08-29 under the owner's standing delegation, by the lead
session (lead-direct tier, one-shot review); to be surfaced to the owner
on return.
