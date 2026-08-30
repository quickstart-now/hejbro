# query-execution (delta)

## MODIFIED Requirements

### Requirement: A db handle executes built statements
A db handle SHALL be constructed from schema declarations plus a driver
and SHALL execute built statements, returning rows typed by the
statement's inferred result type. What is sent to the database SHALL be
exactly the statement's pure `compile()` output.

That fidelity is a statement about the caller's *own* statement: it is
never rewritten, re-rendered, or re-parameterized on its way to the
driver. It has never meant that the statement is the only thing on the
connection — applying an execution context already precedes it with that
context's own role and setting statements inside a wrapping transaction.
A handle carrying a registered context provider therefore opens that
same transaction for executions that would otherwise have gone straight
to the driver, and the caller's statement still arrives byte-identical
to its preview.

#### Scenario: Executed SQL equals previewed SQL
- **WHEN** a statement is compiled for preview and then executed on a db
  handle
- **THEN** the SQL text and parameters the driver receives are identical
  to the previewed compile output, and the resolved rows carry the
  inferred result type

#### Scenario: A context provider precedes the statement without altering it
- **WHEN** the same statement is executed on a handle with a registered
  context provider
- **THEN** the context's role and setting statements are issued first,
  within one transaction, and the statement's own SQL text and
  parameters are still identical to its previewed compile output
