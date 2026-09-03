---
"@hejbro/supabase": minor
---

Supabase driver decorator and RLS execution context surface (#293
group 6): `supabaseDriver(driver)` decorates any `@hejbro/query`
contract `Driver` with Supabase's own contributed roles (`anon`,
`authenticated`, `service_role`), so a schema with zero grants/policies
still unlocks the new context builders. `asUser(claims)` (requiring a
`sub` claim) and `asAnon()` build an RLS execution context — role
`authenticated`/`anon` plus exactly one `request.jwt.claims` JSON
session setting, matching Supabase's own RLS conventions (`auth.uid()`
reads that same setting). Token verification stays with the
application (supabase-js `getClaims`, Clerk `sessionClaims`, Auth0
sessions, or `jose` against a custom JWKS) — this package never accepts
or verifies a raw token itself.
