---
"@hejbro/core": patch
"hejbro": patch
"@hejbro/supabase": patch
---

Internal refactor, no behavior change: closes out #154's CRAP work
(PR2/#210, PR3/#222) by splitting the three remaining violations that
were never `switch`-over-closed-union walkers, so a handler map
couldn't apply to them the way it did for PR2/PR3's conversions --
`retargetProjection` (split by `projectionKind`, plus new test coverage
for its previously-untested `"columns"` branch), `parseSnapshot` (split
into five named validator steps), and the rename-target validator
(split by table vs column target, plus a new table-target test for a
previously-untested `unknown-rename-target` boundary). `pnpm check:crap`
now reports zero violations across `@hejbro/core` and `@hejbro/supabase`.
