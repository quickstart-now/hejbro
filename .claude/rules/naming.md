---
paths:
  - "packages/*/src/**"
  - "packages/*/test/**"
---

# Naming conventions

The notation follows the medium. A token's spelling is decided by where it
ends up, not by where it is written.

## Rule 1 — snapshot vocabulary

A field that names the object itself is `name`; a field that names another
object takes that object's noun.

| Field | Meaning |
|-------|---------|
| `name` | the object's **own** name |
| `schema` | the schema the object lives in |
| `table` | the **referenced** table's name |
| `function` | the **referenced** function's name |

Never `schemaName`, `tableName`, or `functionName` in a snapshot. This rule
governs the **serialized key only** — TypeScript declaration fields,
parameters, and locals keep their descriptive names.

## Rule 2 — kebab-case for artifact tokens

Tokens that materialize in generated artifacts are `kebab-case`: snapshot
values, identities, migration banners, config values, and error/warning
codes (`duplicate-identity`, `duplicate-index-name`).

Tokens whose medium is a TypeScript union stay `camelCase` — if the medium
is TypeScript, the spelling is camel. The expression and statement AST
discriminators (`columnRef`, `sqlTemplate`, `functionCall`, `nullTest`, ...)
follow this in their TypeScript form (the `ExprNode` union itself).

**Since D67/D70 (#110), a subset of these DOES reach a generated artifact**
— this rule's own "never reach an artifact" premise for expression
discriminators no longer holds. `ColumnSnapshot.default`,
`CheckSnapshot.expression`, `IndexSnapshot.where`, and `PolicySnapshot.
using`/`withCheck` are structured expression nodes (not pre-rendered SQL
text, D67), and everything reachable from an expression — `exists()`
drags in `SelectNode`'s own `ProjectionNode`/`JoinNode`/`OrderByTerm`/
`TableRefNode` — can appear in the snapshot too. The expression codec
(`packages/core/src/expr/codec.ts`) is the boundary: it encodes every
discriminator *value* to kebab-case for the snapshot (`columnRef` →
`column-ref`, `functionCall` → `function-call`, `allColumns` →
`all-columns`, ...) and every field naming another schema/table/function
object to D57's vocabulary (`schemaName` → `schema`, `tableName` →
`table`, `columnName` → `column`, `functionName` → `function`) — the
discriminator **field name** itself (`nodeKind`, `projectionKind`, ...)
stays as-is; only its value changes case. The one deliberate exception:
SQL's own tokens (`ComparisonNode.operator`, e.g. `"not like"`;
`OrderByTerm.direction`, `asc`/`desc`) are stored verbatim — they are SQL
syntax the codec must reproduce exactly, not a hejbro-authored vocabulary
token, and kebab-casing `"not like"` would render SQL Postgres rejects
(D36). `PlpgsqlRefNode.path` is also untouched — a local variable path,
never a schema/table/function reference, so D57's vocabulary rule doesn't
apply to it.

| Medium | Notation | Examples |
|--------|----------|----------|
| TypeScript API surface and the `ExprNode` union's own discriminators | `camelCase` | `onDelete`, `securityInvoker`, `nodeKind: "columnRef"` |
| hejbro-authored tokens in generated artifacts, including encoded expression discriminator *values* | `kebab-case` | `all-tables-privileges`, `duplicate-identity`, `nodeKind: "column-ref"` |
| SQL identifiers supplied by the user | `snake_case` | validated by `assertSqlName` (D36), never rewritten |
| Generated SQL keywords, clauses, and operators | lower-case SQL, verbatim | `on delete set null`, `not like`, `asc`/`desc` |

## Why

Snapshots, identities, and banners are a data interchange format read by
humans, diffs, and other tools. camelCase there is a TypeScript habit
leaking into an artifact that is not TypeScript. Keeping the two media
distinct lets a reader tell at a glance which side of the boundary a token
belongs to.

## Enforcement

`packages/core/test/naming-conventions.test.ts` scans **generated
artifacts** — snapshot identity keys, `grantKind` values, kind ids, error
codes, config fields, and golden directory names — and asserts the two
rules above. It tests artifacts, not source text, so a TS-only
discriminator (one that genuinely never reaches an artifact) is out of
scope by construction and needs no allowlist. That is no longer true of
*every* AST discriminator, though: since D67/D70, the test also recursively
walks a real snapshot (built via `buildSnapshot(...)` in memory, never a
committed file) asserting every `*Kind`-suffixed field's value is
kebab-case and that no D57 camelCase reference key survives anywhere —
generically, by field-name convention, not a hand-maintained list of known
node shapes. SQL's own tokens (`operator`, `direction`) are excluded by
construction too — their field names don't end in `Kind`, so the walker
never inspects them; no exemption list needed for them either.

**This walker is not, by itself, a complete D70 check** — it only ever
sees whatever the one hand-written test fixture happens to construct, so
a discriminator value the fixture never exercises (found in #110 review:
`rawSql`'s own encoding — `NODE_KIND_TO_SNAPSHOT.rawSql` mapped to
`"rawSql"`, camelCase, not kebab — went unnoticed by both this walker
*and* the codec's round-trip tests, since encode/decode share one map, so
a wrong-but-consistent spelling round-trips clean) unless something else
also checks the map's own values. Closing that took two more layers, not
one, because a single "is kebab-case" check on the map's values still
missed a wrong-but-kebab-*shaped* spelling, and even a value-correct map
doesn't prove every entry is ever actually reached:

1. **Map-value correctness** (`expr/codec.test.ts`): every value in
   `NODE_KIND_TO_SNAPSHOT`/`PROJECTION_KIND_TO_SNAPSHOT` is asserted to
   equal the kebab-case transform of its *own key* (not just "is
   kebab-shaped" in isolation, which a single-segment typo like
   `"columnref"` would pass) — independent of what any test declaration
   constructs, since the map *is* the whole vocabulary.
2. **Map-key-set completeness** (`naming-conventions.test.ts`): the D70
   fixture is built to exercise every reachable node/projection kind at
   least once, and a dedicated assertion checks the map's key set equals
   (what that fixture's walker actually saw) ∪ (an explicit, categorized
   `UNREACHABLE_NODE_KINDS`/`UNREACHABLE_PROJECTION_KINDS` list, each
   entry carrying a one-line reason — never a bare allowlist, the exact
   pattern #87 already rejected once). Entries whose unreachability is a
   *structural* fact (`plpgsqlRef` — the DSL has no code path that could
   ever build one outside a plpgsql body) are prose-only. Entries whose
   unreachability depends on some *other* function's *current* behavior
   (`allColumns`/`columns` — unreachable only because `query/select.ts`'s
   `buildExists` currently overwrites every subquery's projection with
   `constantOne`) are backed by an actual pinning test asserting that
   behavior, so that changing it turns the pinning test red first and
   forces the list to be revisited — the same staleness failure mode this
   whole completeness check exists to prevent, recurring one level up
   inside its own exemption list, closed the same way.

The three are complementary, not redundant: the snapshot walker covers a
discriminator that reaches an artifact through a path the map doesn't own
(there is none today, but it's the backstop if one is ever added); the
map-value test covers every discriminator's *spelling* regardless of
whether any test happens to build it; the completeness test covers every
discriminator's *reachability*, so a brand-new node/projection kind that's
added to the map but never wired into anything the fixture builds — and
never added to the unreachable list — fails loudly instead of silently
passing every other check.

Machine enforcement of the TypeScript layer is a follow-up: Biome's
`useNamingConvention` is not enabled yet because it currently reports 62
warnings, most of them test fixtures whose snake_case deliberately mirrors
SQL identifiers (#132).
