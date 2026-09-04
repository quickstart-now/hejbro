## ADDED Requirements

### Requirement: A lookup of a name the contract does not vendor is refused
The name-keyed client SHALL refuse a member lookup of a name the contract
does not vendor, with a coded error naming the vendored list, on every
surface it exposes: the client itself, the handle `client.as(context)`
returns, and `fn` on both. A lookup resolves only to a member the surface
carries as its own — a vendored table, `fn`, `as` — or is refused: a name
inherited from `Object.prototype` (`__proto__`, `hasOwnProperty`, …) is
refused, unless the contract vendors that exact name, which always wins.
The one exception is the names the language itself reads off any value —
`then`, `toString`, `valueOf`, `constructor` and `toJSON` — and
symbol-keyed lookups: those SHALL stay readable rather than refused, and
where the surface carries no own member of that name they resolve to
what the language provides (the inherited `toString`, `valueOf` and
`constructor`; `undefined` for `then` and `toJSON`), so awaiting,
stringifying, inspecting and serializing the client value itself keep
working; on those names too an own property wins. The refusal is raised at the lookup, before any
statement is built, so a call chained onto the result never reaches an
uncoded `TypeError`.

The scoped handle SHALL refuse exactly what the unscoped handle refuses,
under the same code and naming the same vendored list. `as` is a member
of the client and not of the scoped handle, so a lookup of `as` on the
scoped handle is refused like any other name it does not carry.

#### Scenario: An unvendored table is refused on the scoped handle exactly as on the client
- **WHEN** a contract vendoring `posts` and the function `add` is built
  into a client, and a name the contract does not vendor is looked up on
  the client and on `client.as(context)` in turn
- **THEN** both lookups are refused with `unknown-contract-table`, each
  naming `posts` as the vendored list, and neither yields `undefined`

#### Scenario: An inherited name is refused on the scoped handle
- **WHEN** `__proto__` and `hasOwnProperty` are looked up on
  `client.as(context)`, and on its `fn`
- **THEN** each table lookup is refused with `unknown-contract-table` and
  each `fn` lookup with `unknown-contract-function`, never resolving to
  `Object.prototype` or to an inherited function

#### Scenario: The names the language reads stay readable on the scoped handle
- **WHEN** `client.as(context)` is awaited, stringified, and passed to
  `JSON.stringify`
- **THEN** none of those refuses, exactly as for the client itself

#### Scenario: A vendored member resolves on the scoped handle
- **WHEN** `posts` and `fn.add` are looked up on `client.as(context)`
- **THEN** each resolves to the vendored member, and `as` looked up on
  that scoped handle is refused with `unknown-contract-table`
