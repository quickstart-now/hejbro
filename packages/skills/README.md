# @hejbro/skills

Agent skills that teach coding agents how to use hejbro correctly:

- The declaration DSL (schema objects, function/trigger builder)
- Pitfalls — most importantly: never use real JS control flow (`if`/`for`)
  inside a function body; use `ctx.if()` / `ctx.forEach()` builders
- The `hejbro generate` workflow and how to read the migration banner

Planned distribution: the `npx skills add` convention. Built in Phase 7 of
`/docs/plans/2026-08-19-roadmap.md`.
