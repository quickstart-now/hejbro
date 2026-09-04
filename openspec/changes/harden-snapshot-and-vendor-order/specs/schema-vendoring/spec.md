## ADDED Requirements

### Requirement: The client metadata lists columns in physical order
A vendored contract's client metadata SHALL carry each table's columns
as an ordered list in the snapshot's physical column order — the same
order the emitted `Row` interface and the owning repository's own client
use — never as a structure whose iteration order the runtime decides. The
name-keyed client SHALL build its statements from that order, so the
explicit column list a consumer sends is the one the owning repository
would send, whatever the columns are named: a name that looks like an
integer, a name that carries meaning in an object literal, an upper-case
name, or a name that needs quoting keeps its physical position.

A contract vendored before the list existed — metadata carrying the
object-keyed column map — SHALL still build a client; its statements
keep the order that map yields.

#### Scenario: Integer-like column names keep their physical position
- **WHEN** an export whose table records columns `id`, `0`, `label`, `2`
  in that physical order is vendored and the consumer reads the table
- **THEN** the emitted metadata lists the columns in that order and the
  rendered statement names them `"id", "0", "label", "2"`, not with the
  integer-like names first

#### Scenario: Every column-name class keeps its position
- **WHEN** an export's table records, in one physical order, columns
  named like an integer, `__proto__`, `constructor`, in upper case, and
  with a character that needs quoting
- **THEN** the emitted metadata and the rendered statement carry them in
  exactly that order

#### Scenario: A contract with the object-keyed map still builds
- **WHEN** a consumer builds a client from a vendored `contract.ts` whose
  metadata carries the object-keyed column map
- **THEN** the client's tables work as before
