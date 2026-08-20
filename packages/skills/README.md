# @hejbro/skills

Agent skills that teach coding agents how to use hejbro correctly:

- The declaration DSL (schema objects, function/trigger builder)
- Pitfalls — most importantly: never use real JS control flow (`if`/`for`)
  inside a function body; use `ctx.if()` / `ctx.forEach()` builders
- The `hejbro generate`/`hejbro verify` workflow and how to read the
  migration banner
- The `@hejbro/supabase` preset (roles, auth helpers, storage buckets,
  preset warnings)

Source of truth: `/skills/hejbro` (installed with
`npx skills add quickstart-now/hejbro`); this package bundles those files
on npm in Phase 8 (D54). The frontmatter `version` field in `SKILL.md` is
display-only — the skills CLI compares the folder's tree SHA, not the
version string, to decide whether an install is stale.
