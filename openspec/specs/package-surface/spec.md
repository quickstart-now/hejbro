# package-surface Specification

## Purpose
Defines what the user-facing `hejbro` package exports — the declaration
and query vocabulary, not the engine beneath it — and how that surface
is kept complete and pinned as the engine grows.

## Requirements

### Requirement: The hejbro barrel carries the vocabulary, not the engine
The `hejbro` package SHALL export every runtime value a schema author or
query writer uses from `@hejbro/core` — the declaration builders, the
column types, the expression, aggregate and window helpers, the query
builders, `HejbroError` and the user-facing utilities — together with
`@hejbro/query`'s surface and its own configuration and assertion
entries, and SHALL NOT export core's engine: renderers, codecs, the diff
and generation machinery, kind definitions and the registry, the
snapshot codec, traversal tables, and internal brands and helpers. Those
remain importable from `@hejbro/core`, which is the interface presets
and sibling packages build on. Two groups that read as engine are
vocabulary on purpose and stay exported: the three banner readers
(`parseBannerHashes`, `parseBannerVersion`, `parseBannerBaseline`),
which the generate/verify workflow documents as the way a user reads a
migration's banner, and the one brand another shipped requirement names
as reaching users through `hejbro` (`leftJoinedBrand`). Every type
`@hejbro/core` exports SHALL stay reachable from `hejbro` — held by the
barrel's construction (a wholesale type re-export, not a list) and
checked by a type-only import that names the core types shipped specs
reference as reaching users together with a sample of the DSL's own
declaration and stage types — so only runtime values are curated; an engine name remains visible to
the type checker through `hejbro` as a type-only re-export (usable in a
`typeof` position, never as a value), and that is the stated shape of
the curation.

#### Scenario: Autocomplete offers the vocabulary
- **WHEN** a user imports from `hejbro` and reaches for a column type
- **THEN** `real` is exported and `renderExpr`, `renderSnapshot`,
  `SELECT_CLAUSE_TRAVERSALS` and the other engine names are not — a
  value import of an engine name from `hejbro` is a compile-time error
  and the name is absent from the module at runtime

#### Scenario: The engine stays where presets import it from
- **WHEN** a preset or sibling package imports an engine name from
  `@hejbro/core`
- **THEN** it resolves exactly as before; nothing moves out of
  `@hejbro/core`

#### Scenario: Types are untouched
- **WHEN** a type `@hejbro/core` exports is imported from `hejbro`
- **THEN** it resolves; the curation affects runtime values only

### Requirement: The classification is complete and the surface is pinned
The curation SHALL be expressed as two lists — vocabulary and engine —
and `hejbro`'s own test suite SHALL fail when any runtime export of
`@hejbro/core` appears in neither or in both, so that a newly added core
export must be classified before it can ship. `hejbro`'s runtime export
set SHALL be pinned by set equality against a sorted list, so that an
export added or removed without updating the pin fails the test.

#### Scenario: An unclassified core export fails the build
- **WHEN** `@hejbro/core` gains a runtime export that is in neither list
- **THEN** `hejbro`'s test fails naming the unclassified export

#### Scenario: The barrel's composition is pinned
- **WHEN** a runtime export is added to or removed from `hejbro` without
  updating the pinned list
- **THEN** the set-equality test fails naming the difference

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
  registry: those are query positions (`SelectNode | SetOpNode`) the
  lifter reaches through its own query walk, applying
  `selectChildExprs`/`replaceSelectChildExprs` at each `SelectNode` it
  arrives at, and a node whose child is a whole statement (`exists`,
  `selectExpr`) reports no expression child here

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
