# rls-execution-context (delta)

## ADDED Requirements

### Requirement: The Nile preset renders a tenant context
The Nile preset SHALL provide a context builder that names a tenant, and
optionally a user, and SHALL produce a context that names no role. Its
driver SHALL render that context into statements itself, through the
driver-owned rendering contribution, and the statements SHALL be
`SET LOCAL`-form settings: the tenant setting first, and the user setting
after it when a user was named — the order the platform requires
("you must set a tenant context before setting the user context").

The rendering SHALL NOT use `set_config` for either setting. On this
platform `set_config` cannot set the tenant setting at all, and for the
user setting it is accepted while skipping the platform's own
tenant-membership check that the `SET LOCAL` form enforces; a rendering
that used it would be trading a refusal for a silent bypass.

The tenant setting SHALL be the first statement the rendering returns,
and the preset's driver SHALL NOT send any statement of its own ahead of
it — anything it needs inside the transaction rides in the same
rendering, after the context statements. On a **supported base driver**
(one that applies its session settings at connection checkout, see
`driver-contract`), that makes the tenant setting the first statement
inside the transaction as well. On a base that sends its own statements
inside the transaction it opens — the shape this preset does not support
— the tenant setting is still the first statement the query layer sends,
and the platform refuses it; that is the failure the unsupported shape
produces, not an exception to this requirement.

#### Scenario: A tenant context renders the tenant setting first
- **WHEN** an execution runs under a context built for a tenant
- **THEN** the tenant setting is the first statement the query layer
  sends, ahead of the caller's own and of any other statement the preset
  contributes

#### Scenario: On a supported base, the tenant setting is first inside the transaction
- **WHEN** an execution runs under a tenant context on a decorated base
  driver that applies its session settings at connection checkout
- **THEN** the first statement recorded inside the transaction is the
  `SET LOCAL` tenant setting, with no base-driver statement ahead of it

#### Scenario: A user context renders the tenant setting before the user setting
- **WHEN** an execution runs under a context built for a tenant and a user
- **THEN** the tenant setting is sent first and the user setting
  immediately after it, in that order

#### Scenario: The rendering never reaches for set_config
- **WHEN** the preset's rendering is invoked with any context it accepts
- **THEN** none of the statements it returns is a `set_config` call, for
  either setting

#### Scenario: A context that names no role is what the builder produces
- **WHEN** the preset's context builder is called
- **THEN** the context it returns names no role, and the settings it
  carries identify the tenant (and the user, when one was named)

### Requirement: The Nile preset declares a role-less, context-mandatory platform
The preset's driver SHALL declare that its platform has no roles, and
SHALL declare a context mandatory. The first declaration is what admits a
role-less context; it SHALL NOT be read as an exemption for a context
that does name a role, which stays subject to the same declared-role
whitelist. The second declaration is what makes an uncontexted execution
fail closed at hejbro's own layer, because on this platform a missing
context widens visibility to every tenant rather than narrowing it.

Declaring a context mandatory does not block the CLI's catalog read, and
the reason is a property of where that read is issued rather than
anything this preset enforces: it goes through the driver session
directly, not through a `db()` execution surface, and the refusal applies
to execution surfaces only. The preset states this consequence so that
"the platform requires a context" is not read as "the schema check stops
working".

#### Scenario: A role-less context is admitted on this driver
- **WHEN** an execution runs under the preset's own context, which names
  no role
- **THEN** it proceeds, and no role statement is sent

#### Scenario: A named role is still validated on this driver
- **WHEN** a context naming a role outside the declared-role union is used
  on this driver
- **THEN** it is refused before any statement is sent, exactly as it would
  be on a driver that made no role-less declaration

#### Scenario: An uncontexted execution is refused
- **WHEN** a statement is executed on a handle built on this driver with
  no context and no registered provider
- **THEN** it fails with the query layer's `context-required` error before
  anything reaches the database

#### Scenario: The CLI's catalog read still reaches the database
- **WHEN** the schema check reads the catalog against a database served by
  this driver
- **THEN** the read is issued and returns, because it goes through the
  driver session directly rather than through a `db()` execution surface,
  and the mandatory-context refusal therefore does not apply to it

### Requirement: The Nile rendering constrains the values it interpolates
`SET LOCAL` carries no bind parameter, so the tenant and user values are
interpolated into statement text, and the driver — not the query layer —
owns their safety. Both values are UUIDs on this platform. The rendering
SHALL therefore refuse a value that is not a canonical UUID **before any
statement is sent**, with an explicit coded error, and SHALL still apply
the ordinary literal-quoting rule to the value it does interpolate. The
safety of this rendering SHALL be verified in the preset's own package.

#### Scenario: A value that is not a UUID never becomes a statement
- **WHEN** a context is built with a tenant value that is not a canonical
  UUID
- **THEN** the failure is an explicit coded error raised before any
  statement is produced, and no statement reaches the driver — the query
  layer has already opened the wrapping transaction when the rendering
  runs, and that transaction carries none

#### Scenario: An adversarial value never appears raw in the statement
- **WHEN** a value carrying SQL syntax is passed as a tenant value
- **THEN** it is refused by the UUID check, and in no case does the raw
  value appear as its own substring of a rendered statement

#### Scenario: A valid tenant value is quoted, not concatenated
- **WHEN** a context is built with a canonical UUID
- **THEN** the rendered statement carries that value through the literal
  quoting rule rather than by raw concatenation

### Requirement: The Nile rendering is transaction-local
The statements the preset renders SHALL take effect only for the
transaction the query layer opened for that execution — the `SET LOCAL`
form is what gives them that scope — so that no context outlives its
transaction on a pooled connection. This SHALL be verified in the
preset's own package on both sides: the statement form, and the server's
own behavior.

#### Scenario: The rendered statements are transaction-scoped by form
- **WHEN** the rendering is invoked
- **THEN** every statement it returns uses the `SET LOCAL` form rather
  than a session-scoped `SET`

#### Scenario: A later transaction on the same connection sees no previous tenant
- **WHEN** an execution runs under a tenant context and a later
  transaction runs on the same connection without one
- **THEN** the later transaction does not observe the previous tenant's
  context, confirmed against a live database rather than inferred from
  the statement text
