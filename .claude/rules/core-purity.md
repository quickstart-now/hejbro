---
paths:
  - "packages/core/**"
---

# Core purity

`@hejbro/core` is PURE: it takes declaration objects and returns SQL strings
and diff structures. It never reads files, never opens a database
connection, and aims for zero runtime dependencies.

- A change that seems to need I/O here violates the design — stop and
  surface it instead of working around it. Filesystem concerns belong in
  `packages/cli`.
- Adding any runtime dependency requires explicit owner approval.
- Built-in object kinds (table, function, trigger, …) must use the same
  public extension interface that provider presets use (spec §4.1). No
  private shortcuts.
