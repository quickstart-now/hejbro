# Proposal: add-batched-transactions (#486, #891, #892)

## Why

Neon's HTTP one-shot path can apply an RLS context correctly: a single
batch of `set local role` + `set_config(…, true)` + the caller's
statement, sent through `sql.transaction([...])`, runs atomically with
no leakage across calls (measured against a local proxy during the
neon-preset piece, #300). The driver already uses exactly that batch to
carry its session pins with every statement. Yet `db.as(context)` on
that driver fails with `missing-capability: interactive-transactions`,
because the contract's only transactional shape is the callback-scoped
`transaction(callback)`, which is interactive by construction — the
callback decides the next statement from prior results, and a one-shot
request cannot do that. The `false` is honest; the reason is ours: the
contract has no vocabulary for the ability the driver has. The cost is
concrete — RLS-scoped reads are unavailable on the one connection path
Neon recommends for serverless functions.

## What Changes

- **A fourth capability, `batched-transactions`.** A driver declaring it
  can execute a pre-composed list of statements atomically in one
  round trip, in order, and return every member's rows. It says nothing
  about sessions (a batch carries no state to the next batch) and
  nothing about interactivity. The set stays fixed and exhaustive:
  interactive transactions, session state, prepared statements,
  batched transactions; omitting or inventing a key fails to type-check
  as today.
- **A `batch` member on the driver contract**, required like
  `transaction`: a driver declaring the capability `false` implements it
  by throwing the contract's own missing-capability error, the pattern
  `transaction` already follows on the HTTP driver. `@hejbro/neon`'s
  HTTP driver declares `true` and sends the members through
  `sql.transaction([...])` with its session pins first; `@hejbro/pg`,
  the WebSocket Neon driver, and the Supabase and Nile decorators
  declare it `false` — their sessions already give them the interactive
  form, and a second path would be a second thing to keep truthful
  (D95).
- **A context runs in a batch when it cannot run interactively.**
  `db.as(context).execute(statement)`, a provider handle's execution,
  and a context-scoped `fn` call assert *either* capability: with
  interactive transactions they run exactly as today; without them but
  with batched transactions they compose `[…rendering(context),
  statement]` — the same statements the interactive path sends, from
  the same contributed or built-in rendering — into one batch and
  resolve the last member's rows. Neither capability is the same
  missing-capability error as today, naming both. `db.as(context)
  .transaction(callback)` keeps requiring interactive transactions: a
  callback is interactive by definition. A mandatory-context driver
  (`contextRequired`) is served the same way. Which path a handle takes
  is a property of the driver's declaration, never a runtime probe.
- **One exported statement-name helper** (#891). The `hejbro_` + SHA-256
  name `@hejbro/pg` and `@hejbro/neon` each derive today moves to
  `@hejbro/query`'s driver-contract surface as one export; both drivers
  call it and hold no copy, and the two goldens stay as its pin.
- **A multi-command text resolves to its last command's rows** (#892).
  node-postgres answers a multi-command simple-query text with an array
  of results and the vanilla driver returned `undefined` rows for it.
  The contract now states psql's own rule: the rows of the last command
  are what `execute` resolves, on the vanilla and the Neon WebSocket
  drivers alike; `undefined` is never what a caller receives. Refusing
  was rejected: a driver cannot tell a multi-command text apart before
  sending it without parsing SQL, and refusing after the commands ran
  would hide effects that already happened.
- The driver-contract and RLS-context specs are restated; the Neon
  reference's "the HTTP path refuses `db.as`" sentence becomes "the
  HTTP path applies the context in one batch"; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`driver-contract`** — MODIFIED requirements: *Drivers declare their
  capabilities*, *The capability set is exhaustive and statically
  checked* (four keys), *A driver's capability set follows its
  connection path* (a one-shot path declares what its batch can do).
  ADDED requirements: *A driver executes a pre-composed batch
  atomically*, *The prepared-statement name is derived by one exported
  helper*, *A multi-command text resolves to its last command's rows*.
- **`rls-execution-context`** — REMOVED requirements *Context execution
  requires transactions* and *A provider handle requires the
  interactive-transaction capability*; ADDED requirements *Context
  execution requires a transaction, interactive or batched* and *A
  provider handle requires a transactional capability* (the same rules
  with the batched form admitted; their one-shot scenarios inverted).

## Impact

- `@hejbro/query`: `driver/contract.ts` (the key, the `batch` member),
  `db/context.ts` (the capability assertion and the batched path for
  `as`/provider/`fn`), `driver/missing-capability.ts` (the two-key
  message), tests including the tier-obligation check.
- `@hejbro/neon`: `src/http.ts` (`batch`, `true`), `src/driver.ts`
  (WebSocket `false`).
- `@hejbro/pg` and `@hejbro/supabase`: the declaration and the throwing
  `batch`. `@hejbro/nile`: inherited from the base driver — `nileDriver`
  spreads a complete `Driver` and owns no execution path, so both the
  capability record and `batch` reach it whole (486/R7); its obligation
  is verified, not written.
- `skills/hejbro`: `references/neon-preset.md`, `references/query-layer.md`
  (the capability table).

Lands after `add-prepared-statements` archives (its D106 round owns the
"exactly N keys" sentence this change restates); no overlap with any
other change in flight.
