---
"hejbro": patch
---

`import` and `pull` no longer drop a foreign key into a schema
`--schema` didn't name -- the ordinary shape a hosted database's own
platform schemas (`auth`, `storage`, …) have. That reference is kept,
declared against a table this repository doesn't own, and the
generated DDL still carries the constraint.

A column the DSL can't name now gets the reason that actually applies
to it in the loss report -- no declaration key produces its SQL name
back, or a key does but the identifier rule itself rejects the name --
and the only remedy that exists: renaming it in the database. Neither
line says "declared by hand" anymore; no hand-written declaration, in
this repository or a linked one, could ever carry either kind of name.

`import`'s loss report always ends with its own way-out line again,
even when some of the named schemas hold nothing to infer.
