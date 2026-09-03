## ADDED Requirements

### Requirement: An emitted key survives as data, whatever it is named
One key name carries meaning in a JavaScript object instead of becoming
a property, and a vendored schema travels through two objects keyed by
what the declaring repository named things: the description that is read
and the metadata that is emitted. Both SHALL carry every table key,
function key and column key as an own property, whatever the schema
named it — the facts a description holds under such a key SHALL reach
the contract, and the contract's own keys SHALL be own properties at run
time. A key that is silently absorbed rather than carried loses the
column from every statement the client builds, or loses what the
declaring repository said about it, with the contract still compiling
and every type still claiming the column is there.

#### Scenario: A column whose name is meaningful in an object literal is carried
- **WHEN** an export carries a table whose column key is `__proto__`,
  and a contract is generated from it
- **THEN** the generated module's metadata lists that column among the
  table's own column keys, and a read of that table names the column in
  its statement like any other

#### Scenario: What the description says under such a key reaches the contract
- **WHEN** a vendored description holds a column fact under the key
  `__proto__`, carrying that column's TypeScript key and numeric mode
- **THEN** the contract carries that column with the key and the mode
  the description gave it, not with values recovered from elsewhere

#### Scenario: A key that only looks dangerous is carried the same way
- **WHEN** an export carries column keys named `constructor`,
  `prototype`, `hasOwnProperty` and `toString`
- **THEN** each is an own property of the emitted metadata and reaches
  the client's statements, unchanged from how an ordinary key is carried

## MODIFIED Requirements

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
compile on a fresh object literal. A value TypeScript never checked —
built elsewhere, widened, or parsed from text — is refused at the call
instead: the runtime check compares the caller's key set against the
declared arguments, so an argument object carrying a key the function
does not declare is refused, naming that key and the declared ones,
never sent as a missing value for the argument it was misspelling.

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
- **THEN** the call fails to compile; a pre-built value whose key count
  does not match the declared arguments, and one whose keys are the
  right number but name an argument the function does not declare, are
  both refused at runtime before any SQL is sent, the second naming the
  unknown key and the declared arguments

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
