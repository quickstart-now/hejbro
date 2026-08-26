---
"@hejbro/core": minor
---

Column builder type surface for query-layer type inference (#293): a
second, defaulted `TMeta` type parameter on `ColumnBuilder` carries the
declared type name, `notNull`/default visibility, numeric width mode
(`bigint({mode})`/`numeric({mode})`, mirroring Drizzle's surface), and
a jsonb `$type<T>()` brand — all additive, no change to generated SQL,
snapshots, or existing declarations. `NumericMode` and `BigintConfig`
are now exported from `@hejbro/core`'s public surface.
