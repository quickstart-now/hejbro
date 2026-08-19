---
paths:
  - "packages/supabase/**"
---

# Provider preset boundary

`@hejbro/supabase` may only use `@hejbro/core`'s public extension interface
(spec §4.1). A preset contributes exactly four things: custom object kinds,
role/grant presets, typed expression helpers, reserved-area protection
lists.

- If the preset seems to need a special case inside core, the interface is
  wrong — fix the interface, never patch core for one provider.
- This package is the template for future Neon/Nile presets; anything done
  here must generalize.
