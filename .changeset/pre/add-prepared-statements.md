---
"@hejbro/core": minor
"hejbro": minor
"@hejbro/supabase": minor
"@hejbro/query": minor
"@hejbro/pg": minor
"@hejbro/neon": minor
"@hejbro/nile": minor
---

The driver capability set gains a third key, `prepared-statements`, and
`pgDriver`/`neonDriver`'s session-oriented (`Pool`) path can now name
every built statement (`select`/`insert`/`update`/`delete`/a set
operation) it sends, so a connection parses and plans each distinct
text once instead of on every execution:

```ts
const driver = pgDriver(pool, { preparedStatements: true });
```

Opt-in, defaulting to `false` — an existing caller's driver sends
exactly what it always did. A `sql`-kind statement (the escape hatch, a
context's own applied statements, a migration body) is always sent
unnamed regardless of the option, since hejbro parses no SQL and a
`sql`-kind text may carry more than one command. `@hejbro/supabase`'s
`supabaseDriver` now refuses, at construction, a base driver that
declares `prepared-statements: true` for its `"transaction-pooler"`
endpoint — a name prepared on one pooled backend does not exist on the
next one the pooler hands out for a later transaction. Every other
existing driver (`@hejbro/nile`'s decorator, `hejbro`'s CLI paths) is
unaffected and declares `false`.
