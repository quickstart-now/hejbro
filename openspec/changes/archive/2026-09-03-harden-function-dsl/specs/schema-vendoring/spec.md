## MODIFIED Requirements

### Requirement: Every emitted key compiles
The contract emitter SHALL quote a table column key or function argument
key that is not a valid TypeScript identifier, and SHALL import every
value type its own output names, so that a contract compiles whatever the
export carries.

Such a key reaches the emitter from the export it reads, never from a
declaration: a declared column key and a declared function argument key
both derive a hejbro SQL name, and every key that survives that
derivation is already a valid TypeScript identifier. The emitter carries
the key the export holds and never re-derives it, so quoting is what
keeps a hand-edited export — or one written by a toolchain whose rules
differed — compiling.

#### Scenario: A non-identifier key is quoted
- **WHEN** an export whose table fact carries a column key such as
  `user-id`, and whose function fact carries an argument key such as
  `my-arg`, is vendored
- **THEN** the contract compiles and each key is preserved as written

#### Scenario: An interval column compiles
- **WHEN** a schema declaring an `interval` column and an `interval`
  function argument is vendored
- **THEN** the contract compiles with the interval value type resolved
