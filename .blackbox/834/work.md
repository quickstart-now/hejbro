# Work — quickstart-now/hejbro#834

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — metadata.internal hides the seven repository skills from the skills CLI

_2026-09-05T05:17Z_

2026-09-05: after adding `metadata:\n  internal: true` to each .claude/skills/*/SKILL.md, `npx -y skills@1.5.23 add <this checkout> --list` prints "Found 1 skill" and lists `hejbro` only (before: 8). Claude Code still loads the seven as project skills (extra frontmatter keys tolerated; `paths:` on roundtrip-verification untouched). README's `-s hejbro` line stays.

