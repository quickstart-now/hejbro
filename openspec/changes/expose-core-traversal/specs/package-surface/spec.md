## ADDED Requirements

### Requirement: Core's traversal registry and kind-change guards are extension surface
`@hejbro/core` SHALL export, as part of the interface presets and
sibling packages build on, the expression traversal it closes over —
a function returning a node's child expressions in a fixed order, and a
function rebuilding a node from replacement children in that order —
and the kind-change guards its own kinds emit through: one that yields
a change's next side and refuses a change that carries none, one that
yields its previous side the same way, and one that yields both,
all refusing with `invalid-kind-change`. A preset or sibling package
that walks or rebuilds an expression, or reads a kind change's sides,
SHALL do so through these exports and SHALL NOT keep a table of node
child positions or an inline guard of its own, so that a node kind
gaining a child, or a change shape moving, is absorbed in one place.
These names are engine, not vocabulary: importable from `@hejbro/core`,
classified as engine in `hejbro`'s curation, and absent from the
`hejbro` barrel at runtime. A query position — an `exists` or
`selectExpr` node's query, a `with` body, a set operation's branch — is
not an expression child; the registry stops at it and a consumer that
needs to look inside descends through the query walker on its own, as
the RLS validator does.

#### Scenario: A preset walks an expression through the registry
- **WHEN** the RLS validator of the Supabase preset and the query
  package's parameter lifter each traverse an expression that holds a
  child in every node position the registry knows — a comparison's two
  sides, a logical operator's operands, a `not` or null-test operand, an
  `inList`'s operand and its values, a `between`'s operand and its two
  bounds, a function call's arguments, a template's interpolated
  expressions, a window function's own call, its partition keys and its
  order keys, an aggregate filter's call and its condition, the kinds
  that carry no child at all — a literal, a raw SQL fragment, a column
  reference, a PL/pgSQL reference — and an `exists` or `selectExpr` node
  standing as a leaf
- **THEN** each reaches every child through the exported traversal, no
  package-local table of child positions exists in either, and the
  behaviour each site's own tests pin is unchanged
- **AND** a statement's own clauses — a `with` node's body, a set
  operation's branches, a subquery's clauses — stay outside this
  registry: those are `SelectNode` positions the lifter reaches through
  `selectChildExprs`/`replaceSelectChildExprs`, and a node whose child
  is a whole statement (`exists`, `selectExpr`) reports no expression
  child here

#### Scenario: A kind reads a change's sides through the guards
- **WHEN** the storage-bucket kind and the example preset's kind emit for
  a change that carries only the side they need, and for one that does
  not
- **THEN** the first emits as before and the second fails with
  `invalid-kind-change` from the exported guard, and neither kind holds
  an inline guard
- **AND** a guard folded into the exported helpers names the change by
  its kind token, as core's own kinds do; the refusal code is unchanged

#### Scenario: The exports are engine surface
- **WHEN** a value import of any of the five names is attempted from
  `hejbro`, and from `@hejbro/core`
- **THEN** the first is a compile-time error and absent at runtime, and
  the second resolves; `hejbro`'s classification test names each as
  engine
