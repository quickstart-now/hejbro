---
"hejbro": patch
---

`check` under a preset that declares no planning (`explainUnavailable`) no longer normalizes the inside of a string literal — a quoted word or a qualifier-like name inside a literal is content and a difference it carries is reported as not compared; a reserved keyword stays quoted under the identifier-unquoting step; and a failed catalog read in that mode gets a `Next:` that names the catalog read instead of `EXPLAIN`.
