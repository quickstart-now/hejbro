---
"hejbro": patch
---

`hejbro check` now compares an index's partial predicate and its own
expression columns, and a generated column's expression, through the
server's own rendering — the same probe a check constraint's expression
already used — instead of reporting an index as present regardless of
its predicate or expression, and a generated column as always missing
its (nonexistent) default (#778, #781). A matching generated column no
longer produces a finding at all. Under a registered preset that
declares the platform cannot plan a statement (e.g. `@hejbro/nile`), the
same normalized-text fallback now applies to all four surfaces, and the
report's coverage-boundary line names them together.

A not-compared or differing finding's expression text is now delimited
with backticks instead of double quotes, so a declared expression that
itself begins with a quoted identifier (a table-bound column reference)
no longer collides with the message's own delimiter (#779). Finding
codes and `Next:` remedies are unchanged.
