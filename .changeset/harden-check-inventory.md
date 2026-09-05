---
"hejbro": minor
---

`hejbro check` now reports the columns, indexes and check constraints a
database holds on a table the declarations manage and no declaration
covers, beside the unmanaged tables it already reported: informational,
never a difference, and never affecting the exit code. An index that
backs a declared primary key or unique column is not among them — the
declaration accounts for it — while an index backing any other
constraint names that constraint on its line. The loss report `import`
and `pull` print no longer says hejbro will not mention an omitted index
or check constraint again: `check` now keeps listing them.
