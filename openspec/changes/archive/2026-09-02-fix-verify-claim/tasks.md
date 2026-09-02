# Tasks: fix-verify-claim (#616)

Lead-direct piece (one delta, one test, one guide sentence). Base: dev
`a45a3a24`. Estimates at agent scale.

## 1. The sentence, its pin, and the guide (#616)
Files: `openspec/changes/fix-verify-claim/specs/cli-commands/spec.md`,
`packages/cli/test/verify.test.ts`, `docs/guide/renames.md`,
`.changeset/*.md`, `openspec/task-times.csv`

- [x] 1.1 (~7m) The delta above lands; `docs/guide/renames.md` stops
      saying the banner lines are "hashes over file contents" and says
      what they hash (the declaration snapshot before and after — so a
      reverted or hand-edited *body* is not what breaks the chain; a
      reverted *file* is). Failing test: `verify.test.ts` — "a body edit
      that keeps the banner lines passes (stated limitation)" — a
      migration's DDL line altered, banner untouched, `verify` exits 0.
      It arrives green by construction (it pins a limit, not a repair);
      its red is reserved for the day a body hash ships. Control in the
      same test: the same file with its `snapshot:` line altered exits 1
      (the existing check-4 test already proves it; cite, do not copy).
      `patch` changeset (documented CLI contract corrected); ledger row.

## Verification (definition of done, not a task)
`openspec validate fix-verify-claim --strict`; `openspec show
fix-verify-claim --diff` with zero "No matching main requirement"
warnings; `TURBO_FORCE=1 pnpm check / check-types / test`; no file under
`packages/*/src` in the diff.
