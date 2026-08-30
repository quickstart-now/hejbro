# driver-contract Delta

## MODIFIED Requirements

### Requirement: Drivers declare their capabilities
A driver SHALL declare which execution capabilities it supports —
interactive transactions and session state, the complete set — as
inspectable data on the driver value. The query layer SHALL consult
these declarations instead of probing behavior at runtime.

#### Scenario: Capabilities are inspectable
- **WHEN** a driver value is examined before any connection is made
- **THEN** its declared capability set is readable and matches what the
  driver actually supports

### Requirement: The capability set is exhaustive and statically checked
The driver capability set SHALL be a fixed, enumerated set of named
capabilities — exactly two: interactive transactions and session
state — never an open-ended list, and never a bare index signature.
Extending the set is a spec change to this requirement, not a driver's
own addition. A driver value's capability declaration SHALL name every
capability in the set; omitting one, or naming one outside the set,
SHALL fail to type-check rather than silently default. A mandatory
prerequisite every driver must supply just to be a driver at all
(parameterized statement execution) SHALL NOT be represented as a
capability — it lives on the driver's own required surface,
unconditionally, never as a value that could read `false`.

#### Scenario: Omitting a declared capability is a compile error
- **WHEN** a driver's capability declaration omits one of the fixed set's
  keys
- **THEN** the program fails to type-check

#### Scenario: Naming an undeclared capability is a compile error
- **WHEN** a driver's capability declaration includes a key outside the
  fixed set
- **THEN** the program fails to type-check

#### Scenario: A capability explicitly declared false fails closed
- **WHEN** a driver declares a capability as `false` (as opposed to
  omitting it)
- **THEN** an operation requiring that capability fails with the
  missing-capability error exactly as it would for an undeclared driver
  — `false` is never treated as "attempt it anyway"
