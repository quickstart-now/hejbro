# Contract: diagnostics

Every code below is thrown at **declaration time** via `throwHejbroError`
(`packages/core/src/error.ts`), kebab-case, message = cause + one `Next:`
sentence (spec §7, #220). `<…>` are substitutions; wording is the contract
the unit tests assert on (exact prefix up to `Next:`).

| Code | Where | Message |
|---|---|---|
| `unknown-index-method` | `IndexBuilder.using()` | `index access method "<m>" is not one hejbro accepts — supported: btree, hash, gin, gist, spgist, brin, hnsw, ivfflat. Next: pick one of those (extension methods are added on request).` |
| `unique-index-method` | `IndexBuilder.on()` | Named: `index "<name>" is unique and uses "<m>" — Postgres supports unique only on btree indexes. Next: drop .unique() or drop .using("<m>").` Unnamed: `the unique index on ("<c1>", "<c2>") uses "<m>" — Postgres supports unique only on btree indexes. Next: drop .unique() or drop .using("<m>").` (column list from `.on()`'s own arguments — the builder doesn't know the table name yet, so no derived name is available to fall back on). |
| `invalid-sql-name` (existing) | `op()` | `operator class name "<c>" is not a valid hejbro SQL identifier — names must match ^[a-z][a-z0-9_]*$ … Next: rename the operator class to snake_case.` (via `assertSqlName(opclass, "operator class", null)`) |
| `index-expression-requires-name` | `table()` | `table "<t>" declares an index over an expression without a name — hejbro cannot derive a name from an expression. Next: name it — index("<t>_<cols>_idx") (or index("<t>_expr_idx") when the expression references no column).` |
| `index-expression-subquery` | `table()` | `index "<n>" on table "<t>" contains a subquery in an index expression — Postgres forbids subqueries in index expressions. Next: express the column over this table's own columns, or index the plain column and filter elsewhere.` |
| `index-expression-foreign-column-ref` | `table()` | `index "<n>" on table "<t>" references column "<s>.<t2>.<c>" in an index expression — an index expression can only see this table's own columns. Next: use this table's own columns (the callback's \`t\`).` |
| `unknown-index-column` (existing) | `table()` | unchanged; now iterates only `name` entries |
| `duplicate-index-name` (existing) | `table()` | unchanged |

Not diagnosed by hejbro (Postgres reports at apply time, by design — spec
Assumptions): operator class does not exist; method needs an extension that
is not installed; opclass incompatible with the column type or method.
