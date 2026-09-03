---
"@hejbro/core": minor
---

`json`, `jsonb` and `bytea` columns take raw values. An insert or update
accepts any JSON-serializable value for a json column and a `Uint8Array`
for a bytea column — hejbro serializes and encodes them, and the declared
type decides between a `json` and a `jsonb` cast, so a `json` column never
acquires jsonb's key reordering. A `.$type<T>()` brand now narrows the
write as well as the read: a branded column accepts its own `T` and
nothing wider. `sql` still works everywhere, and arrays of these three
element types remain `sql`-only (#425).
