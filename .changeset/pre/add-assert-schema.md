---
"hejbro": minor
---

`assertSchema(handle, options?)` checks that the database
`handle.driver` is actually connected to matches every declaration
`handle.schema` exports — the same comparison `hejbro check` runs from
the CLI, callable from application code (a startup check, a health
endpoint, a test suite) instead of only the command line. Opt-in and
explicit: constructing a `db()` handle never connects or reads anything
on its own, and `assertSchema` is the only thing in this surface that
does.

Resolves to a report (`{ compared, notCompared }`) on a clean match —
`compared` names every declared identity actually compared against the
live catalog, `notCompared` names any it could not, each with a reason.
Every failure carries a stable `code` — the error's own class is not
part of the contract — and `assertSchema` itself raises exactly three:
`assert-schema-diverged` (at least one compared declaration doesn't
match the database), `assert-schema-not-compared` (a declaration should
have been compared and couldn't, or the schema module declares nothing
at all — `options.allowNotCompared` opts out of failing on the former
without silencing a real divergence), and
`assert-schema-catalog-unreadable` (the database catalog itself could
not be read). A declaration no registered kind owns at all propagates
`generateMigration`'s own `unowned-declaration` unchanged, before the
catalog is ever read.
