---
"@hejbro/core": minor
---

A plpgsql body can execute a statement for its side effect, a dropped
statement builder is caught instead of silently disappearing, and a
`defineFunction`'s scalar `returns` accepts a column builder.

`ctx.execute(<select | insert | update | delete>)` records a statement in
body order, rendered `perform <sql>;` for a select (plpgsql's own rule
for a bare `SELECT`) and `<sql>;` for a mutation; a mutation ending in
`.returning()` is refused (`execute-expects-no-returning`), since
plpgsql's `perform`/bare form has no `into` clause to receive returned
rows. A statement builder constructed inside a body and never passed to
a consumer (`ctx.execute`, `ctx.return`, `ctx.row`/`ctx.rowOrNull`/
`ctx.forEach`, `exists`/`notExists`/`jsonArrayFrom`/`jsonObjectFrom`, a
set-operation combinator, or `defineView`) now fails the declaration
with `statement-builder-unused` instead of silently generating a body
missing that statement (#423, #426). `ctx.if`/`elseIf` also widen to
accept the same `Condition` union a query-side `where(...)` already
does, so a `sql` fragment reads as a body condition too.

`defineFunction`'s `returns` accepts a column builder wherever it
accepts a raw type node, matching what `args` already accepts (#433):
`returns: varchar({ length: 10 })` keeps its length, an enum keeps its
identity, and a `$type`-branded `jsonb` return keeps its brand, all the
way through to `db.fn`'s own call result type. A declared numeric mode
(`bigint({ mode: "number" })`) now reaches `db.fn`'s runtime conversion
instead of always falling back to the type's own default. A `returns`
builder carrying `.notNullElements()` is refused
(`returns-not-null-elements-unsupported`): a returns clause derives no
backing CHECK, so the flag would promise something nothing enforces.
