# Work — quickstart-now/hejbro#769

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Scoped name-keyed handle guarded like the client

_2026-09-04T16:00Z_

Built: `buildTableSurface` in `packages/query/src/client/name-keyed-db.ts` merges a
table map + `fn` and wraps the result exactly once with `wrapWithTableGuard`. Both
`createNameKeyedDb`'s top-level surface and its `.as(context)` closure now call this
one function, so the scoped handle carries the same unknown-member guard, `unknown-contract-table`
code, vendored-list message, and pass-through list (`then`/`toString`/`valueOf`/`constructor`/`toJSON`)
as the unscoped client. `as` itself is not an own key on the scoped surface, so looking
it up there is refused like any other unvendored name.

Measured: red was exactly the scoped-handle rows in a new `it.each` table (`nope`,
`__proto__`, `hasOwnProperty`, `as`) plus a `scoped.nope.select()` pin (coded error at
the lookup, never a bare `TypeError`) — 5 of 31 tests in `errors.test.ts`. Every unscoped
row and every pass-through row was already green (no regression). After the fix: 31/31
in the file, 64 files / 932 tests package-wide.

