# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Feature work is spec-driven via OpenSpec: the `/opsx` commands
  (`.claude/commands/opsx/`) drive propose → approve → implement →
  archive; inside each task the superpowers cycle applies (brainstorming
  for `[design]` tasks, TDD for all).
- The owner's global `typescript-rules` skill applies to our own TS source.
- Path-scoped rules live in `.claude/rules/` (core purity, provider preset
  boundary) and load automatically when files under those paths are read.
