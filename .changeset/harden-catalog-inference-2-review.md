---
"hejbro": patch
---

`hejbro import`/`pull` now read a stored generated column as a
generated column instead of losing it silently, and an index, check
constraint, UNIQUE constraint, generated column, primary key or
foreign key naming a column this reading left out — for its own name,
its enum type, or (new) a type no column builder expresses — is itself
excluded and named on its own loss-report line, with no "rename …"
remedy for the type-loss cause (no such remedy exists today). A
generated column dropped this way then drops its own index, check
constraint, UNIQUE constraint, primary key and foreign key in turn,
each named on its own line. The loss report's own remedy line now says
to either re-run `hejbro import` into a fresh `--out` and merge the
new declaration, or add it by hand, and a UNIQUE constraint dropped
for its own name is announced as a unique constraint rather than a
plain index. `hejbro pull`'s own approximation lines for a foreign key
or a primary key under a derived name now say only what the pulled
contract carries, never a promise about `generate`/`check`, commands a
pull consumer never runs. `hejbro pull`'s own "pulled ..." line, lock
file and contract metadata now list exactly the schemas that actually
contributed something to the snapshot — never a schema the database
doesn't hold or one this reading could not carry the name of — and a
pull that ends up with nothing to carry into the contract now refuses
(`pull-nothing-to-infer`/`pull-nothing-declarable`) instead of writing
an empty bundle. A schema that produced nothing to infer now prints
its own line where it belongs, inside the "Not inferred" band, for
both `import` and `pull` — it used to print after every "Omitted"
line instead.
