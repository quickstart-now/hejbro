---
"hejbro": patch
---

`import` and `pull` no longer stop when a table, schema, index or check
has a name a declaration cannot carry: that object is left out and
named in the loss report, and the rest of the database is still read.
