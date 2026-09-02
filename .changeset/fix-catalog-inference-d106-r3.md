---
"hejbro": minor
"@hejbro/core": minor
---

D106 R3-B3: a foreign key can now carry an explicit `name`
(`extras.foreignKeys`'s own optional field, validated per D36 the same
way `index()`'s optional name already is) — `hejbro import`/`pull` set
it automatically whenever a database's own foreign key name is
expressible, so a database hejbro did not create (most often named
`<table>_<column>_fkey`, Postgres's own default) keeps its real
constraint name through `generate`/`check` instead of drifting
permanently to hejbro's own derived `<table>_<columns>_fk`. A name
identical to the derived one is never written, so a hejbro-created
database's own starter files stay byte-identical. When the catalog's
own name isn't a valid hejbro SQL identifier, the reading falls back
to the derived name and the loss report names the approximation.

`@hejbro/core` exports `deriveForeignKeyName` and `assertSqlName` (the
same D36 rule this feature validates a foreign key's own name against)
for callers that need the same derivation/validation rule this feature
uses internally.
