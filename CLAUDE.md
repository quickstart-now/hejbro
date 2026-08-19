# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Each roadmap phase runs the superpowers cycle: `brainstorming` →
  `writing-plans` → TDD implementation → review → PR.
- The owner's global `typescript-rules` skill applies to our own TS source.
- Path-scoped rules live in `.claude/rules/` (core purity, provider preset
  boundary) and load automatically when files under those paths are read.
