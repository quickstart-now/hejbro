---
"hejbro": minor
---

`hejbro generate` now accepts `--flag=value` as well as `--flag value`
for every value-taking flag (`--config`, `--name`, `--rename`,
`--confirm-drop`). The equals form used to be silently dropped —
for `--rename`/`--confirm-drop` specifically, that meant an unresolved
rename ambiguity fell back to a destructive drop+create instead of a
rename. The suggested rerun command printed on an ambiguity diagnostic
is unaffected either way.
