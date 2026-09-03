---
"hejbro": minor
"@hejbro/query": minor
---

Catalog inference (#604): `hejbro import --schema <name> --out <dir>`
reads a live database's catalog, read-only, and writes one starter
declaration file per schema using the DSL's own builders — the
introspection-assisted seeding half of #385 that hand-writing
`table()` declarations previously left entirely manual. `--schema` and
`--out` are both required with no default (a hosted Postgres's own
platform schemas are schemas too, and adopting them by default is
never wanted). A column whose SQL name no declaration key can
round-trip is left out of the starter file and named in the loss
report, which every file's own header also carries in full; two
schemas whose tables reference each other never produce files whose
imports form a cycle — the closing foreign keys go through an
unexported reference-only handle instead. `import` never overwrites an
existing file.

`hejbro pull --db-url <db> --schema <name>` is the new database-sourced
fallback for a vendored contract, for when the schema repository
`link`/`vendor` need isn't reachable: it writes into the exact
destination `hejbro vendor` does, marked with no commit, so `vendor
--check`/`outdated` refuse to compare it against one (naming `link` as
the way to a commit-anchored contract instead).

`ContractOrigin`/`ContractMetadata` (`@hejbro/query`) are now a
discriminated union on `source` — `"git"` (vendor's own, `commit`/
`exportHash`) or `"database"` (pull's own, `database`/`schemas`) — so
code that forgets the database-sourced case fails to compile rather
than at run time. A contract a pre-#604 `hejbro vendor` already wrote
and committed keeps type-checking unchanged after upgrading.
