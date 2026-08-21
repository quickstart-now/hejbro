---
"@hejbro/core": minor
"@hejbro/supabase": minor
---

Every user-facing `HejbroError` now pairs its "why" with a "Next:"
clause stating a concrete, executable action (spec §7) — 59 call sites
across `@hejbro/core` and `@hejbro/supabase` gained one, either by
adding the literal `Next:` marker to guidance that was already there or
by authoring new guidance. Internal-invariant guards (unreachable by
any user action, confirmed by direct reproduction for the two
ambiguous cases) are left as-is. A new `scripts/check-next-marker.mjs`
(wired into `pnpm check:next-marker` and CI) keeps this a checked
invariant going forward instead of a one-time sweep.
