# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Feature work is spec-driven via OpenSpec: the `/opsx` commands
  (`.claude/commands/opsx/`) drive fluid OPSX actions (create, implement,
  update, archive — anytime; owner approval gates the contract, not the
  sequence); inside each task the superpowers cycle applies (brainstorming
  for `[design]` tasks, TDD for all).
- Layer boundaries (owner, 2026-08-30): spec artifacts are OpenSpec-only
  (never superpowers' own spec docs or writing-plans); implementation runs
  the superpowers cycle; orchestration is team-up. Divergence tripwires
  and the repair heuristic are injected via `openspec/config.yaml`.
- The owner's global `typescript-rules` skill applies to our own TS source.
- Path-scoped rules live in `.claude/rules/` (core purity, provider preset
  boundary) and load automatically when files under those paths are read.
