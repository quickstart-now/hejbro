# Delta: package-surface

## Purpose

Defines what the user-facing `hejbro` package exports — the declaration
and query vocabulary, not the engine beneath it — and how that surface
is kept complete and pinned as the engine grows.

## ADDED Requirements

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
checked by a type-only import of the core types shipped specs name —
so only runtime values are curated; an engine name remains visible to
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
