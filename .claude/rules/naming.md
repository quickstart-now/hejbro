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
are internal and never reach an artifact, so they are out of scope.

| Medium | Notation | Examples |
|--------|----------|----------|
| TypeScript API surface and internal union discriminators | `camelCase` | `onDelete`, `securityInvoker`, `kind: "columnRef"` |
| hejbro-authored tokens in generated artifacts | `kebab-case` | `all-tables-privileges`, `duplicate-identity` |
| SQL identifiers supplied by the user | `snake_case` | validated by `assertSqlName` (D36), never rewritten |
| Generated SQL keywords and clauses | lower-case SQL | `on delete set null` |

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
rules above. It tests artifacts, not source text, so internal TS
discriminators are out of scope by construction and need no allowlist.

Machine enforcement of the TypeScript layer is a follow-up: Biome's
`useNamingConvention` is not enabled yet because it currently reports 62
warnings, most of them test fixtures whose snake_case deliberately mirrors
SQL identifiers (#132).
