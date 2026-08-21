---
"@hejbro/core": minor
"@hejbro/supabase": minor
"hejbro": minor
---

Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
`@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
`test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
now — no CI gate yet, and no change to any published `dist/` output.
