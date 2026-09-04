---
"@hejbro/core": patch
---

`defineFunction` now refuses, with `invalid-sql-name`, an argument key
whose derived SQL name isn't a valid hejbro SQL identifier — the same
D36 rule a column key already enforces — instead of silently emitting an
unquoted, invalid name into the generated DDL and function body. A
literal `__proto__:` key in an `args` object literal, which replaces the
object's prototype instead of declaring an argument, is refused
separately with `args-prototype-key`, naming the computed-key form that
does declare one. `ctx.return` no longer accepts a mutation whose chain
never called `.returning()`: the pre-`.returning()` stage is excluded at
the type level, and a caller that reaches `ctx.return` with the type
bypassed now fails at declaration time with `return-expects-returning`
instead of rendering a `return query …;` statement Postgres accepts at
creation and rejects only when the function is called. `ctx.execute`
keeps accepting a mutation at either stage through the new exported
`ExecutableQuery` type (re-exported by `hejbro`).
