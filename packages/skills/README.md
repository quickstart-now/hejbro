# @hejbro/skills

Agent skills that teach coding agents how to use hejbro correctly:

- The declaration DSL (schema objects, function/trigger builder)
- Pitfalls — most importantly: never use real JS control flow (`if`/`for`)
  inside a function body; use `ctx.if()` / `ctx.forEach()` builders
- The `hejbro generate`/`hejbro verify` workflow, how to read the
  migration banner, and what to do when an apply tool fails partway
  through a migration
- The `@hejbro/supabase` preset (roles, auth helpers, storage buckets,
  preset warnings)
- The query layer (`db()`, the `select`/`insert`/`update`/`deleteFrom`
  chain, the `sql` escape hatch, `db.fn`, RLS execution contexts,
  transactions, error codes)
- Adopting hejbro into an existing (brownfield) database

Source of truth: `/skills/hejbro` (installed with
`npx skills add quickstart-now/hejbro`); this package is `private` and
ships no npm bundle — the repository stays the only distribution channel
(D62). The frontmatter `version` field in `SKILL.md` is display-only —
the skills CLI compares the folder's tree SHA, not the version string, to
decide whether an install is stale.

## Test gates

This package's own tests gate the skill's docs, not hejbro itself:

- `test/links.test.ts` — every repo path the skill's docs cite exists on
  disk.
- `test/snippet-compile.test.ts` — every ` ```ts ` fenced block under
  `skills/hejbro/` type-checks against this repo's real source.
  `test/snippet-check.ts` is the shared extraction/compile engine;
  `test/markdown-files.ts` is the shared doc-file walker;
  `test/snippet-check-negative.test.ts` (with
  `test/fixtures/snippets/negative.md` and `test/fixtures/preludes/*.ts`)
  is the meta test proving the gate's own failure paths fire. A fence's
  info string can carry:
  - `prelude=<name>` — prepends `test/fixtures/preludes/<name>.ts`
    before type-checking.
  - `expect-error=<code>` — the numeric TS diagnostic code the block
    must raise (e.g. `expect-error=2322`).
  - `no-check=<slug>` — a reason slug, excluded from type-checking and
    checked instead against the `NO_CHECK_ALLOWLIST` constant.
