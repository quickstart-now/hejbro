---
paths:
  - "packages/supabase/**"
---

# Provider preset boundary

`@hejbro/supabase` may only use `@hejbro/core`'s public extension interface
(spec §4.1) plus, since D95, `@hejbro/query`'s public driver contract
type for its own driver contribution (`supabaseDriver`, `asUser`/
`asAnon`) — never a concrete driver implementation (`@hejbro/pg`) or any
other query-layer internal. A preset contributes exactly five things:
custom object kinds, role/grant presets, typed expression helpers,
reserved-area protection lists, and a driver contribution (a `Driver`
decorator plus an RLS execution context surface).

- If the preset seems to need a special case inside core, the interface is
  wrong — fix the interface, never patch core for one provider.
- This package is the template for future Neon/Nile presets; anything done
  here must generalize.
