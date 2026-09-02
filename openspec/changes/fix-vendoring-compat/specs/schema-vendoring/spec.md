## ADDED Requirements

### Requirement: A vendored mutation's type matches what it returns
The name-keyed client's bare `insert()`, `update()` and `delete()` SHALL
type as resolving to no rows, because the statement they send carries no
`RETURNING` clause. A consumer who needs the written rows back reads them
in a second statement; the client SHALL NOT promise rows in a type it
never delivers.

#### Scenario: A bare insert resolves to no rows, and says so in its type
- **WHEN** a consumer awaits `client.<table>.insert(row)` through a
  vendored contract
- **THEN** the promise resolves to an empty array and its awaited type is
  exactly `ReadonlyArray<never>` — the table's row type is not what it
  resolves to

### Requirement: A contract vendored before functions were carried still runs
`createNameKeyedDb` SHALL accept contract metadata that carries no
`functions` member — the shape every contract vendored before the typed
function surface existed has — and expose an empty `fn`.

#### Scenario: A pre-functions contract still builds a client
- **WHEN** a consumer builds a client from a vendored `contract.ts` whose
  metadata has no `functions` member
- **THEN** the client's tables work as before and `fn` carries no callables

### Requirement: Every emitted key compiles
The contract emitter SHALL quote a table column key or function argument
key that is not a valid TypeScript identifier, and SHALL import every
value type its own output names, so that a contract compiles whatever the
schema declared.

#### Scenario: A non-identifier key is quoted
- **WHEN** a schema declaring a function argument under a key such as
  `my-arg` is vendored, and an export whose table fact carries such a
  column key is read
- **THEN** the contract compiles and the key is preserved as written

#### Scenario: An interval column compiles
- **WHEN** a schema declaring an `interval` column and an `interval`
  function argument is vendored
- **THEN** the contract compiles with the interval value type resolved

## MODIFIED Requirements

### Requirement: A description format newer than the reader is refused
Format skew is asymmetric because the description format only ever
gains fields. A toolchain meeting a **newer** format SHALL refuse,
naming the version it found, the version it knows, and the command that
installs a newer hejbro. A toolchain meeting an **older** format SHALL
read it and treat the facts that format does not carry as absent.

Format 1 now has two shapes: the one written before functions carried
their argument and return facts, and the one written since. A reader
meeting the earlier shape SHALL read the function as present and its
typed-call facts as absent, and SHALL NOT carry that function into the
contract's `Functions` section — a call it cannot type is not offered.

#### Scenario: A newer format is refused with the command that fixes it
- **WHEN** the vendored description declares a newer format
- **THEN** the failure names both versions and the command that
  installs a newer toolchain, and no contract is written

#### Scenario: An older format is read (unobservable until a second format exists)
- **WHEN** the vendored description declares an older format
- **THEN** it is read, and facts that format does not carry are absent

#### Scenario: A pre-functions export reads with its functions absent
- **WHEN** `hejbro vendor` reads a format-1 export whose function facts
  carry no `args` or `returns`
- **THEN** the export is read, the tables are carried as before, and the
  contract's `Functions` section carries none of those functions

### Requirement: The contract carries a typed function surface
A vendored contract SHALL emit, under its `Functions` section, one entry
per function the export carries an export name for — keyed by that
export name, while `Tables` stays keyed by SQL name as it already
ships, because a function is called the way the declaring repository
calls it and a function's SQL name is frequently not the name anyone
wrote — with the argument object type (the declared TypeScript
keys, each typed as the declared argument type would be read) and the
result type (the mapped scalar type, or the rows of the returned table,
with the same numeric-mode and element-nullability rules the table
entries follow). A function synthesized as part of a trigger definition
carries no export name and SHALL NOT appear. Neither SHALL a function
whose returned table the contract does not itself carry: there is no
row type to resolve to, and typing it against a table that is not there
would be a guess — the rule a foreign key pointing outside the schema
already follows. The name-keyed client
built from that contract SHALL expose those functions under `fn`,
keyed the same way, as callables whose rendered SQL is the same
parameterized invocation the declaring repository's own `db.fn` renders
— an explicit column list for a table return, never `select *` — and
the same surface under `.as(context)`, since a function called for a
role is the case a scoped handle exists for. So a consumer calls the
owning repository's functions with the types the declarations gave them
and no declaration in hand.

A mismatch is caught where TypeScript can see it: a missing or wrongly
typed argument fails to compile anywhere; an extra property fails to
compile on a fresh object literal, and a pre-built value carrying one is
refused at runtime by the argument-count check, never sent.

#### Scenario: A scalar function crosses the boundary
- **WHEN** a schema declaring a scalar-returning function is vendored
  and the consumer calls it through the client's `fn` with matching
  arguments
- **THEN** the call type-checks against the declared argument keys and
  types, executes a parameterized invocation, and resolves to the
  mapped scalar type — through the scoped handle as well, where the
  same invocation runs inside the context the scope applies

#### Scenario: A table-returning function crosses the boundary
- **WHEN** a schema declaring a function that returns a table is
  vendored and called through the client's `fn`
- **THEN** it resolves to that table's typed rows and the rendered SQL
  lists the returned columns explicitly

#### Scenario: A mismatched call fails the type check
- **WHEN** the consumer calls a vendored function with a missing or
  wrongly typed argument, or with an extra property on a fresh object
  literal
- **THEN** the call fails to compile; a pre-built value carrying an
  extra property is refused at runtime before any SQL is sent

#### Scenario: A function returning an uncarried table is absent
- **WHEN** a vendored schema declares an exported function returning a
  table the contract does not carry
- **THEN** that function has no `Functions` entry and no `fn` callable,
  rather than an entry typed against rows the contract cannot describe

#### Scenario: A synthesized trigger function is absent
- **WHEN** the vendored schema's only functions come from trigger
  definitions
- **THEN** the contract's `Functions` section is empty and the client
  exposes no `fn` entry
