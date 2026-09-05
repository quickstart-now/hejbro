# AGENTS.md

Guidance for AI coding agents working in this repository. Tool-agnostic:
`CLAUDE.md` imports this file; other agents read it directly.

## What this project is

**hejbro** — declare everything in your Postgres database (tables, RLS,
functions, triggers, views, grants) in TypeScript, generate deterministic
migration SQL. Generic Postgres core + provider presets (Supabase, Neon,
and Nile shipped). Apache-2.0, built AI-natively under `quickstart-now`.

## Read first

Truth lives in three layers (D87):

1. `docs/specs/2026-08-19-hejbro-design.md` — approved design spec and
   decision log. **Why** things are the way they are. Decisions were made
   explicitly by the project owner. Never silently revisit them; if
   blocked, surface it and ask. The decision log is owner-gated and stays
   here, outside `openspec/`.
2. `openspec/specs/` — **what the product does now**, one capability at a
   time, as scenario prose paired with the test suite. Specs are never
   written retroactively: a capability gets its spec when a change first
   touches it, so the directory grows from empty.
3. `openspec/changes/` (+ `changes/archive/`) — **what is moving and what
   moved**. The changes directory is the frontier and the plan of record.
   `docs/plans/2026-08-19-roadmap.md` is the phased record of the 0.1.x
   line and stays as history; new work is not planned there.

## Commands

```bash
pnpm install         # pnpm only — never npm/yarn
pnpm check           # Biome lint + format check (fix: pnpm format)
pnpm check-types     # tsc via turbo
pnpm test            # vitest via turbo (harness lands in Phase 1)
pnpm build           # turbo build
```

In-process package tests (`packages/supabase`, `packages/cli`,
`examples/{postgres,supabase}`'s chain tests) import `@hejbro/core` (and
`hejbro`/`@hejbro/supabase`) straight from source via a vitest alias, so
they never go stale even run outside turbo (#131). CLI subprocess tests
(the ones that spawn the built `dist/cli.js`) can't be aliased the same
way — they check that `dist` is at least as new as its own `src` and fail
loudly if not. That check's own remedy is `pnpm build --force`, not a
plain `pnpm build`: turbo's cache is content-addressed, so a src file
whose mtime moved without its content changing can still hit the cache,
and a plain `pnpm build` then replays old logs without writing `dist`
again. One more exception to "never go stale" (D106 R1 NB1, #677): an
in-process test whose fixtures import `"hejbro"` and load through jiti
(not vitest's own module graph) resolves that import via real Node
module resolution to `dist`, same as a subprocess test — it needs the
same `assertBuiltCli` dist-freshness guard (`packages/cli/test/loader-cycle.test.ts`).

## Repo map

| Path | Package | Constraint |
|------|---------|------------|
| `packages/core` | `@hejbro/core` | **PURE**: no fs, no DB, (near-)zero runtime deps |
| `packages/query` | `@hejbro/query` | Statement compiler, driver contract, RLS execution context, thenable chain surface — pure over core's DSL, no I/O of its own |
| `packages/pg` | `@hejbro/pg` | Vanilla node-postgres driver implementing `@hejbro/query`'s driver contract |
| `packages/cli` | `hejbro` | User-facing DSL + query-layer re-exports + CLI; the only place that touches the filesystem |
| `packages/supabase` | `@hejbro/supabase` | May only use core's public extension interface (and `@hejbro/query`'s driver contract for its own driver decorator) |
| `packages/skills` | `@hejbro/skills` | Agent skills for hejbro *users* |
| `examples/` | — | Real declarations doubling as integration tests |

## Hard rules

- **Spec-driven changes** (D87). Work that alters an externally observable
  contract — public API surface, generated SQL, file or wire formats, CLI
  output or error text, documented behavior — goes through an OpenSpec
  change: proposal → owner approval → tasks → TDD implementation →
  review → PR → adversarial spec-only review (D106) → archive
  (artifacts under `openspec/changes/<id>/`; the `/opsx` commands
  drive the cycle). A bug fix that restores
  already-specified behavior, and internal refactors, follow the plain
  cycle without a proposal. Never start a change by writing production
  code.
- **Tasks are sized and test-bound** (D88). `tasks.md` top-level groups
  are parallel-safe slices (no file overlap between groups). A task is
  estimated in pure work minutes (over 10 → split; 5 or under → merge),
  names the failing test it starts from — with inputs as wide as the
  scenario's sentence: a universal claim starts from an input table, not
  one example (D110) — and tasks that settle a contract
  detail (signature, error shape, key order, output format, SQL text) are
  marked `[design]` — their open decisions are settled with the owner
  before code. Verification is the definition of done, never a task.
  A change whose input comes from outside hejbro's own output (a catalog
  reading, a parsed file, a vendored artifact) has its piece reviewed
  before merge by a context-free input constructor — delta scenarios and
  public surface only, concrete inputs run, never the implementer's
  reasoning — in place of the piece reviewer (D110); D106 stays the
  archive gate.
  Durations land in `openspec/task-times.csv` when a group completes.
- **Core purity is load-bearing.** If a change needs I/O in `@hejbro/core`,
  the design is being violated — stop and reconsider. Rule:
  `.claude/rules/core-purity.md`.
- **The provider interface is the product.** If a preset needs a core
  special case, the interface is wrong — fix the interface. Rule:
  `.claude/rules/provider-preset.md`.
- **All GitHub-facing text in English** (code, comments, docs, issues, PRs,
  commits).
- **Comments state the constraint only.** A comment records what the code
  cannot show (the "why", the invariant, the trap); measurement
  narratives, derivations, and process history go to the PR body or
  `.blackbox/` (D89) — never multi-screen comment blocks.
- TypeScript strict. Our own source: no `any`, no `let`/`var`, no
  `for`/`while`, no ternary. Machine-enforced, not habit (#447): Biome
  covers `any`/`var`/ternary; `pnpm check:bans` (CI) walks `packages/*/src`
  for the rest — `let` and every loop form. *Generated SQL output* and the
  *user-facing DSL design* are governed by the spec, not by these style
  rules.
- **Naming follows the medium** (D57): snapshot self/reference fields are
  `name`/`schema`/`table`/`function`; tokens that reach generated artifacts
  are kebab-case; TypeScript-only unions stay camelCase. See
  `.claude/rules/naming.md`.

## Git workflow

- Base branch `dev`. Feature branches, PR back to `dev`, **squash merge**.
  PR body lists the commits to be squashed and references the related
  issue.
- Releases: `dev` → `main` PR, **merge commit** (never squash/rebase).
  A long-lived PR -- the release PR and the Version Packages PR -- runs
  its heavy checks only when the owner approves them (#809): `verify`
  waits at the `ci-approval` environment review, and every dev merge
  that moves the PR's head cancels the wait instead of re-running.
  Feature PRs run immediately.
- Conventional commits, enforced by commitlint (husky):
  `<type>(<scope>): <subject>` — lower-case subject, ≤72 chars.
- **Every PR that changes a published package carries exactly one
  `.changeset/*.md`** (D59), starting with `phase8-changesets` (this rule's
  own landing PR included — it ships a `minor` changeset). CI's `changeset
  status` enforces exactly this scope — a docs-only or private-package-only
  PR (`@hejbro/skills`, `examples/`, this file) doesn't need one and the
  gate doesn't ask for one; use `pnpm changeset add --empty` if you want an
  explicit record anyway. Run `pnpm changeset` and answer its prompts; pick
  `minor` for a new capability, `patch` for a fix, and `major` is not used
  before 1.0 (see the design spec's decision log). The seven published
  packages (`@hejbro/core`, `hejbro`, `@hejbro/supabase`, `@hejbro/query`,
  `@hejbro/pg`, `@hejbro/neon`, `@hejbro/nile`) are a **fixed** group in
  `.changeset/config.json` — they always version together, so a
  changeset naming any one of them is enough to move all seven.

## Hard gates (owner approval required)

- Publishing to npm. The `@hejbro` scope is owned by the project owner
  (confirmed 2026-08-19). Since D63 the release itself runs in GitHub
  Actions, so the gate is not "who runs the publish command" but **who
  approves the release**: merging the "Version Packages" PR is the release
  decision and is reserved for the owner. Publishing then runs from GitHub
  Actions; the owner touches it four times — (0) "Approve and run" the
  bot PR's CI (it opens as `action_required`), (1) merge the Version
  Packages PR on `dev`, (2) merge `dev` → `main` with a merge commit,
  (3) approve the `npm` environment — and step 3 is the irreversible one:
  npm keeps a version number even if it is unpublished. Never merge that
  PR, and never change the release workflows, without the owner.
- Adding runtime dependencies to `@hejbro/core`.
- Changing any decision in the spec's decision log.
- Building anything listed under "Deferred" in the roadmap.

## Agent tooling configuration (D90)

Claude Code settings follow the large-codebases guide
(code.claude.com/docs/en/large-codebases) **by fit-test** — adopt what
the repository's size and shape justify, record what was reviewed and
rejected (decided 2026-08-26):

- **Adopted.** Instruction layering stays root AGENTS.md +
  `.claude/rules/` (`core-purity.md`, `provider-preset.md`, `naming.md`
  — path-scoped; naming needs cross-package globs no per-directory file
  can express). `.claude/settings.json` carries `Read` deny rules for
  build outputs (`node_modules/`, `dist/`, `build/`, `coverage/`,
  `.turbo/`) so stale artifacts are never read as truth.
  `.claude/skills/roundtrip-verification/` loads on demand for
  `examples/**` work.
- **Reviewed and rejected.** Per-package CLAUDE.md split — single-owner
  repo, no directory-owner model to serve; revisit if AGENTS.md outgrows
  ~200 lines or directory owners appear. `worktree.sparsePaths` —
  worktrees here are created manually, and a sparse checkout breaks the
  pnpm workspace + turbo task graph. `worktree.symlinkDirectories:
  ["node_modules"]` — pnpm's workspace symlinks would silently point a
  worktree's `@hejbro/*` dependencies at the main checkout, breaking
  worktree isolation. Deny rules on committed generated artifacts
  (`examples/*/migrations/`, goldens) — those are reviewed artifacts
  agents must read; "generated" does not mean "vendored".
- **Personal-level, not committed.** Code intelligence (typescript-lsp)
  is a user-level install: a public repository does not impose
  language-server binaries on contributors.

## Provenance

`.blackbox/` at the repository root is the flight recorder (D89; folder
form since #785). One folder per work item, keyed by its issue number
(`.blackbox/785/`), holds `meta.json` (machine-owned: kind, parent,
status, one line per PR — `closes`, `refs` or `own`; the PR's content
pin itself lives once under `.blackbox/prs/<N>.json`, meta v3 since #866), `decisions.md` (every decision as it is
made — owner decisions `D#` as English rewrites of the owner's words, AI
rulings `R#` with kind interpretation/extension/stop, basis and
ratification) and `work.md` (what was built and measured, `W#`). Entries
older than #785 are single files, listed as legacy by the generated
`.blackbox/README.md`. The tool is `pnpm blackbox …`
(`node .blackbox/bin/blackbox.mjs`, vendored from the `dd-blackbox`
skill); the conventions live in that skill and in the generated README.
Enforcement is not this paragraph: the Claude Code hooks in
`.claude/settings.json` save owner inputs at the keystroke, refuse a team
brief that cites no recorded ruling, and gate `gh pr merge` on the
record; CI's `blackbox` job runs the same check before every other job
and, through the `hello-pooh-blackbox` GitHub App, pins the PR itself —
the pin commit is created by the Git Data API, signed by GitHub and
attributed to the App, so it passes the signed-commit ruleset.
Read the folders only when investigating a rule's origin; never load
them during normal work.

## Before claiming done

- [ ] `pnpm check`, `pnpm check-types`, `pnpm test` all pass — show output.
      In a review or otherwise isolated worktree, run every gate with
      `TURBO_FORCE=1`: the turbo cache is shared across worktrees, so a
      fresh worktree's first run can replay **another worktree's** logs
      as `FULL TURBO` hits and "the gates passed here" stops meaning
      anything (#448 — measured: a detached review worktree replayed the
      main checkout's `check-types` logs). Forcing skips cache reads but
      still writes, so later runs stay fast
- [ ] Public API surface changed → `skills/hejbro` updated in the same PR
      (the skill documents the surface; a stale skill is a broken user
      contract, not a docs nit)
- [ ] README CRAP block refreshed (`pnpm check:crap`)
- [ ] OpenSpec change state current (`tasks.md` ticks; archive on
      completion; durations in `openspec/task-times.csv`). A delta's
      MODIFIED/REMOVED/RENAMED-from titles must match the base spec's
      `### Requirement:` lines verbatim — `openspec validate --strict`
      never checks that (#510); `pnpm check:modified-titles` does, and CI
      runs it on one leg
- [ ] Wrote `openspec/task-times.csv` rows → README task-time badges
      refreshed too (`pnpm check:tasktime`). CI enforces this on one
      matrix leg only, so it surfaces as a single-leg failure long
      after the change looks green locally
- [ ] A subprocess-spawning suite timed out under `pnpm test` → a timeout
      is the last thing to raise; measure the load first (#673). Three
      files spawn `tsc`: `packages/cli/test/declare-emit-callback-shadow.types.test.ts`
      and `examples/cli-smoke/test/e2e.types.test.ts` run in the
      `test:types` phase after `turbo run test` (isolated, 30s ceiling);
      `examples/cli-smoke/test/vendored-contract.test.ts` stays in the
      contended phase under its 120s ceiling (24s at 32 burners, 30s on
      GitHub's runner). Counting two instead of three is the mistake the
      measurement itself made once
- [ ] The PR's work item is recorded and pinned: `pnpm blackbox new <issue>`
      at start, `pnpm blackbox add decision|ruling|work …` as things happen,
      and `pnpm blackbox pin <issue> --pr <N> && pnpm blackbox index` in the
      PR's checkout after the last content commit — `pnpm blackbox check
      --pr <N>` must pass (the merge hook and CI's first job run it too)
- [ ] PR body lists the commits to be squashed
