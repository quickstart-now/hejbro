# Proposal: harden-query-guards (#769, #761, #449)

## Why

Three defects sit on `@hejbro/query`'s guard surfaces. Each one lets
something the query layer cannot serve pass without a word — a silent
`undefined`, a silent rollback, a check that says something other than
its contract. They ship together because they are one defect class and
one package, and one pull request costs less than three.

1. **The scoped handle of the name-keyed client skips the unknown-member
   guard (#769).** `createDb(conn)` refuses `client.nope` with
   `unknown-contract-table`, and `client.fn.nope` with
   `unknown-contract-function`. `createDb(conn).as(context)` returns a
   plain spread object instead: `scoped.nope` is `undefined`,
   `scoped.nope.select()` is a `TypeError` with no code, and
   `scoped.__proto__` is `Object.prototype`. The one handle that exists
   for running under a role is the one that cannot name a typo.
2. **The conformance kit's leading-token normalization leaves a glued
   semicolon on the word (#761).** The driver contract says a statement
   is classified by the word it leads with once trimmed, lower-cased and
   stripped of trailing semicolons. The kit strips only the final run of
   semicolons, so `commit; ;` leaves the token `commit;` and is classified
   ordinary — an envelope whose transaction has ended passes — while
   `begin; set local x` leaves `begin;` and a conforming wire is refused.
   The spec and the kit say different things.
3. **A statement issued beside an in-flight nested transaction is
   unguarded (#449).** `Promise.all([tx.transaction(a), tx.execute(s)])`
   sends `s` between the nested transaction's `SAVEPOINT` and its
   `RELEASE`/`ROLLBACK TO`, so when the nested callback throws, `s`'s
   effect is rolled back with it, with no error. The sibling case — two
   nested transactions at once — is already refused; the statement case
   is not.

## What Changes

- **The scoped handle is guarded exactly as the unscoped one.** The
  handle `client.as(context)` returns goes through the same
  unknown-member guard, with the same code, the same vendored-list
  message and the same pass-through list for the names the language
  itself reads (`then`, `toString`, `valueOf`, `constructor`, `toJSON`).
- **The kit classifies by the leading word as the contract says.** The
  leading word is the first run of characters that are neither
  whitespace nor `;`; a second word counts only when whitespace alone
  separates it from the first. The contract sentence is restated to
  define exactly that, and the kit's own edges — a comment-led statement,
  a semicolon inside a string literal, a multi-statement string — are
  pinned by tests rather than left to inference.
- **A statement beside an in-flight nested transaction is refused.**
  While a nested transaction is in flight, only the nested callback's own
  `tx` may send; a statement from the `tx` that started it, or any `tx`
  above it, is refused before it is sent, with a coded error naming the
  two ways out. A nested handle used after its callback settled is
  refused too, under its own code. Sequential use is untouched.
- The user-facing skill (`skills/hejbro/references/query-layer.md`)
  documents the new refusals; one `patch` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`schema-vendoring`** — ADDED requirement: *A lookup of a name the
  contract does not vendor is refused*. No requirement covers the
  name-keyed client's unknown-member guard today (recorded as a gap when
  the guard was last repaired), so the scoped-handle fix cannot be a
  MODIFIED delta; this requirement states the guard for every surface
  the client exposes — the client, the scoped handle, and `fn` on both.
- **`driver-contract`** — MODIFIED requirement: *Every declared tier's
  obligation is machine-verified in this repository*. The
  classification sentence defines the leading word precisely, and three
  scenarios pin the spellings the definition decides.
- **`query-execution`** — ADDED requirement: *A statement beside an
  in-flight nested transaction is rejected*, the statement-side sibling
  of *Concurrent nested transactions are rejected*, which stays as it
  is.

## Impact

- **Affected code**: `packages/query/src/client/name-keyed-db.ts`,
  `packages/query/src/testing/driver-conformance.ts`,
  `packages/query/src/db/transaction.ts`, their tests, and one
  Docker-gated witness in `packages/pg/test/integration.test.ts`
  (local-only; `packages/pg/src` is untouched).
- **Breaking**: none for a caller who does not rely on a defect. A caller
  who awaited a statement beside an in-flight nested transaction now
  receives a coded rejection instead of a silent rollback; a caller who
  read an unvendored name off the scoped handle now receives the same
  refusal the unscoped handle already gave.
- **Publishing**: one `patch` changeset naming `@hejbro/query` (the
  seven published packages are a fixed group).
- Refs #769, #761, #449.

## Out of scope

- **Serializing a statement behind the nested transaction** instead of
  refusing it — reordering what the caller wrote is a second silent
  behavior, and a nested callback that awaits the queued statement would
  deadlock.
- **Reading SQL lexical structure in the kit** — stripping leading
  comments, recognizing `prepare transaction`, or seeing the chained
  transaction `commit and chain` opens. The kit reads the leading word
  and nothing else; those are separate findings with their own tracking.
