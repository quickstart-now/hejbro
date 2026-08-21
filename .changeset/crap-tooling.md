---
"@hejbro/core": minor
"@hejbro/supabase": minor
"hejbro": minor
---

Add CRAP score (complexity² × (1 − coverage)³ + complexity) tooling for
`@hejbro/core` and `@hejbro/supabase`: `@vitest/coverage-v8`, a
`test:coverage` task, and `scripts/check-crap.mjs`. Reporting only for
now — no CI gate yet. `package.json` (a `devDependencies` entry and a
new script) does change in all three published packages; `package.json`
is always packed regardless of `files`, so D59's changeset rule applies
literally here, not by analogy to a prior PR's precedent.
