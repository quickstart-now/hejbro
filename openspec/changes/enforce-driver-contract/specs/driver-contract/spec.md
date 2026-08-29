## ADDED Requirements

### Requirement: The missing-capability error has one definition
`@hejbro/query` SHALL export a thrower that constructs the driver
contract's own missing-capability failure. A driver package SHALL
construct this failure by calling that export, never by reproducing its
message text.

#### Scenario: A preset driver constructs the shared error
- **WHEN** a driver lacking a capability refuses an operation requiring it
- **THEN** it throws the error built by `@hejbro/query`'s exported
  thrower, carrying the same code, message, and enriched fields as any
  other driver's refusal for the same capability and operation

#### Scenario: The message text has no second copy
- **WHEN** any driver package's source is inspected
- **THEN** the missing-capability message text appears only inside
  `@hejbro/query`, and every other driver's refusal is produced by
  calling the export, not by restating the text

### Requirement: Every declared tier's obligation is machine-verified in this repository
A driver shipped from this repository SHALL be checked, at test time,
against the obligation its declared `session-state` tier carries: a
`false` declaration is checked for carrying its settings with every
execution, in that order; a `true` declaration is checked for delivering
them through its session-setup hook. The check SHALL read which tier
applies from the driver's own capabilities declaration, never from a
choice the caller makes independently of it, and SHALL NOT use observed
behavior to infer, normalize, or correct the declaration itself — reading
the declaration to select an obligation is required; changing it from
what is observed is forbidden. This verification is repo-internal; it is
not part of any package's published surface. Exposing it as a public
export is additive and is deferred until a driver author outside this
repository needs it — deferring does not modify this requirement.

#### Scenario: A driver that fails its declared tier's obligation is caught
- **WHEN** a driver's actual behavior does not carry out the obligation
  its own capabilities declare
- **THEN** a test run against it fails, naming which tier's obligation
  was not observed

#### Scenario: A driver checked against the wrong tier is refused, not silently passed
- **WHEN** a driver is checked with the observation shape for a tier
  other than the one its own capabilities declare
- **THEN** the check itself refuses, rather than silently applying the
  wrong obligation or passing without having checked anything

#### Scenario: A compliant driver's declaration is left unchanged
- **WHEN** a driver's behavior is checked against its declared tier and
  found compliant
- **THEN** its capabilities value reads exactly as it did before the
  check ran
