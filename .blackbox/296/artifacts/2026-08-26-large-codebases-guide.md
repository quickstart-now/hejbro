# 2026-08-26 — Large-codebases guide adopted by fit-test (D90)

Refs:
- .claude/settings.json @ blob 9b105895c853abd772d9fce14ececcd95aad85db
- .claude/skills/roundtrip-verification/SKILL.md @ blob 03a5e513e0c342304155be17b46300e775221066
- AGENTS.md @ blob ee19aa976a683e646f0fae978019c22ebeaa68ed
- docs/specs/2026-08-19-hejbro-design.md @ blob e319003e6030b0265ebdd003d3ff59312747c82c

Session: Claude Code (Fable 5), 2026-08-26 — same session as the
OpenSpec/blackbox adoption entries; this change stacks on that PR's
branch. Owner inputs are English rewrites of Korean originals.

---

## Input — manage per the guide, and make it portable

> I want hejbro managed according to the guide at
> code.claude.com/docs/en/large-codebases. And I want it written into a
> personal skill too, so it can be used outside hejbro.

## Assistant response and decisions

Fetched the guide and the memory-mechanics page it defers to, measured
hejbro (442 tracked files, packages 3.1M + examples 468K, single owner,
sessions always start at the repo root), and ran the adoption scope as a
five-decision brainstorm (one decision at a time, background first, one
question each):

1. **Instruction layering — keep root AGENTS.md + `.claude/rules/`**
   (owner chose the recommendation after asking for a deeper
   rules-vs-per-package-CLAUDE.md comparison; the comparison that
   settled it: rules trigger on glob patterns while nested CLAUDE.md
   triggers per directory, `naming.md` targets files scattered across
   core/cli/supabase so a full split is impossible — only a half-split
   — and per-package files would force an AGENTS.md + CLAUDE.md shell
   pair per package to stay tool-agnostic; rules support symlink
   sharing, matching the owner's agent-skills distribution model).
   Mitigation adopted for the other-agents-visibility gap: AGENTS.md
   names all three rule files explicitly.
2. **Committed `.claude/settings.json` = deny rules only.**
   `Read` deny for `node_modules/`, `dist/`, `build/`, `coverage/`,
   `.turbo/`. `worktree.sparsePaths` rejected (worktrees here are
   manual `git worktree add`; sparse checkout breaks pnpm workspace
   install and the turbo graph). `worktree.symlinkDirectories:
   ["node_modules"]` rejected as hazardous: pnpm's workspace symlinks
   would resolve a worktree's `@hejbro/*` deps to the main checkout —
   the same interference class as the shared-worktree incident (#102).
   Committed generated artifacts (migrations, goldens) deliberately not
   denied — reviewed artifacts agents must read.
3. **Code intelligence — user-level typescript-lsp install** on the
   owner's machine, not a committed `enabledPlugins`: a public repo
   should not impose a language-server binary on contributors; usage
   evidence may later justify promotion (matches the owner's
   usage-evidence plugin-audit philosophy). Machine state at decision
   time: `tsserver` present, `typescript-language-server` absent.
4. **One repo skill** — `roundtrip-verification`, root
   `.claude/skills/` with `paths: examples/**` (central placement per
   decision 1). Content = run commands + D49 pass criteria +
   failure-pattern interpretation from the Phase 7/8 findings (cluster
   roles, one-shot grants, predrop ordering, vacuous-pass guards,
   symmetric-comparison blind spot, storage exclusion). Release
   procedure and the stale-dist pitfall stay in AGENTS.md (gate and
   high-frequency content belong in the always-loaded layer).
5. **Personal skill name = `dd-claude-repo-setup`** (owner picked the
   broader name over the recommended `dd-repo-scoping`) — lands in
   quickstart-now/agent-skills via a fresh clone (the standing clone
   holds another session's dirty branch), plus a local
   `~/.claude/skills/` install; recorded there with its own blackbox,
   not here.

D90 records the fit-test and both lists (adopted / rejected with
reasons) in the owner-gated decision log; the ORM decision rows planned
for #293 shift to D91+ (issue body updated).

## Internal processing

Guide and memory-docs pages fetched fresh (not from memory) before the
comparison; repo measurements (`git ls-files | wc -l`, `du`, rules
inventory, gitignore, absence of a committed settings file) taken before
proposing anything. The five decisions were settled through
AskUserQuestion with a written ledger; decision 1 took two rounds — the
owner's free-text reply asked for the deeper comparison before
accepting. Gates run before the PR on the stacked branch; this change is
config/docs only, no changeset.
