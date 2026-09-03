---
"hejbro": minor
---

`hejbro baseline` adopts a database hejbro did not create. It writes the
same first migration and snapshot `generate` would, marks that migration
in its banner as describing objects that already exist — register it as
applied, do not run it — and says so in its report before you can run the
file. `verify` accepts the chain it starts, and every later `generate`
emits only what changed. It refuses on a project that already has
migrations, naming `generate` instead (#385).
