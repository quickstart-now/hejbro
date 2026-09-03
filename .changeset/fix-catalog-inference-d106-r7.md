---
"hejbro": patch
---

A table named the same as the extras callback's own parameter (`t`) no
longer breaks its own starter file: it's now written under a different
identifier, and the file loads and type-checks like any other.

A file that carries more than one foreign key into the same
out-of-scope table now declares one reference-only handle for that
table, not one per foreign key -- the handle names the table the same
way regardless of how many of its own foreign keys reach it.

That handle's own comment now says why it exists instead of always
claiming a declaration-file cycle: a handle standing in for a table
this run never read says so, and a handle cutting an actual cycle
keeps its previous wording.

The loss report's omitted-index and omitted-check lines no longer
suggest declaring the object by hand -- an index or check constraint
whose catalog name isn't a valid hejbro identifier can't be carried by
any declaration, hand-written or not; renaming it in the database is
the only way back.
