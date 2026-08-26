---
"@hejbro/core": minor
---

Generic type surfaces for `defineFunction` and the mutation builders
(#293, tasks 4.10/4.11-mutation): `FunctionDeclaration` now carries a
second, defaulted `TArgs`/`TReturns` type parameter pair recording the
declared `args` shape and `returns` target, and `InsertFinal`/
`UpdateFinal`/`DeleteFinal` (and their `*Returnable`/`*Filterable`
intermediates) now carry defaulted `TTable`/`TReturning` parameters
tracking the target table and the `.returning(...)` projection through
`insert`/`update`/`deleteFrom`'s whole chain. Both are additive,
phantom-typed (an optional marker field that is never actually
assigned, so it is simply absent from the runtime object — not merely
hidden from enumeration) narrowing-only changes — every existing
non-generic consumer
(`function-kind.ts`, `define-trigger.ts`, `render-body.ts`) keeps
compiling unchanged against the bare, defaulted type names, and no
runtime shape, generated SQL, or snapshot changes. This lets
`@hejbro/query`'s `Db.execute(...)` resolve the exact row shape for
`insert(...)`/`update(...)`/`deleteFrom(...)` statements the same way
it already does for `select(...)`.
