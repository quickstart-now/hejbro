---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
---

Add Changesets-based release tooling: `.changeset/config.json` (a fixed
version group across the three published packages, public npm access,
`dev` as the base branch), root `changeset`/`version-packages`/`release`
scripts, and the one-`.changeset/*.md`-per-PR rule in `AGENTS.md`.
Introducing the release infrastructure itself is not a patch.
