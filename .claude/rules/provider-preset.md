---
paths:
  - "packages/supabase/**"
  - "packages/neon/**"
  - "packages/nile/**"
---

# Provider preset boundary

A provider preset package (`@hejbro/supabase`, `@hejbro/neon`,
`@hejbro/nile`) may only use `@hejbro/core`'s public extension interface (spec §4.1) plus, since
D95, `@hejbro/query`'s public driver contract type for its own driver
contribution (a `Driver` overload/decorator, plus context builders) —
never a concrete driver implementation (`@hejbro/pg`) or any other
query-layer internal. A preset contributes exactly five things: custom
object kinds, role/grant presets, typed expression helpers, reserved-area
protection lists, and a driver contribution.

A preset never references another preset's internals either — two
presets that need the same shape (an oid type override, a claims type)
each define their own; structural agreement between platforms is not a
reason to import across the boundary.

- If a preset seems to need a special case inside core, the interface is
  wrong — fix the interface, never patch core for one provider.
- `@hejbro/supabase` was the template this rule generalized from;
  `@hejbro/neon` was the first package that tested the generalization, and
  `@hejbro/nile` the second — built with no core special case and no
  cross-preset import, confirming the interface generalizes past the two
  platforms it was drafted against.
- The prohibition is on what a preset **ships and imports at runtime**;
  a concrete hejbro driver may appear in a preset's `devDependencies` as
  the **base driver of its own tests or live witness** — that is how a
  decorator preset proves itself, and it never reaches the published
  `dependencies`.
