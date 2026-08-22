# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- Each feature runs Spec Kit for the *what* (`/speckit-specify` →
  `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks`; skills are
  installed under `.claude/skills/speckit-*`) and the superpowers cycle for
  the *how* (TDD implementation → review → PR). `/speckit-implement` and
  `/speckit-taskstoissues` are not used here. Read
  `.specify/memory/constitution.md` before planning.
- The owner's global `typescript-rules` skill applies to our own TS source.
- Path-scoped rules live in `.claude/rules/` (core purity, provider preset
  boundary) and load automatically when files under those paths are read.
