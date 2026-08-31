# driver-contract (delta)

## ADDED Requirements

### Requirement: The Nile preset ships a decorator driver
The Nile preset SHALL ship its driver as a decorator over a driver the
caller already built, rather than as a driver that wraps a client library
of its own. The platform speaks plain Postgres on one connection path,
so there is no second path to model and no wire to reimplement. The
package SHALL declare no runtime dependency on any Nile package.

The decorator SHALL add exactly what the platform needs — a context
rendering and the two platform declarations — and SHALL pass everything
else through unchanged:

- `transaction` SHALL be the base driver's, and the decorator SHALL NOT
  send any statement of its own before the caller's callback runs;
  anything it needs inside the transaction rides in its rendering.
- `capabilities` SHALL be the base driver's, unchanged. A base that does
  not declare interactive transactions is therefore refused a context by
  the query layer's existing capability gate, and the decorator SHALL NOT
  make it appear otherwise.

#### Scenario: The decorator forwards the base's transaction untouched
- **WHEN** an execution opens a transaction through the decorated driver
- **THEN** the base driver's own transaction is what runs, and no
  statement issued by the decorator precedes the caller's callback

#### Scenario: The decorator forwards the base's capabilities
- **WHEN** a decorated driver's capability declaration is examined
- **THEN** it reads exactly as the base driver's does, with no capability
  added, removed, or rewritten by the decoration

#### Scenario: A base without interactive transactions is still refused a context
- **WHEN** a context is used on a decorated driver whose base declares
  interactive transactions `false`
- **THEN** the execution fails with the missing-capability error, and the
  preset's rendering is never invoked

#### Scenario: The package carries no provider client dependency
- **WHEN** the published package's manifest is examined
- **THEN** it declares no dependency — runtime, peer, or optional — on a
  Nile client package

### Requirement: The Nile decorator states which base drivers it supports
A base driver whose own session statements are sent **inside the
transaction it opens** would place those statements ahead of the tenant
setting, which this platform refuses. The preset SHALL therefore support
base drivers that pin their session at connection checkout — outside any
transaction — and its documentation SHALL state the unsupported shape so
a reader meets it before a database does.

#### Scenario: A base that pins at checkout is supported
- **WHEN** the decorator is built over a base driver that applies its
  session settings at connection checkout
- **THEN** an execution under a tenant context sends the tenant setting as
  the first statement inside the transaction, and the base's own settings
  are not among the statements that precede it there

#### Scenario: The unsupported shape is documented where users read
- **WHEN** the preset's user documentation is examined
- **THEN** it states that a base driver applying session statements
  inside its own transaction is not supported by this decorator, and why
