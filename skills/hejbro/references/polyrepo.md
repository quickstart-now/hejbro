# Schema across repositories (link / vendor)

Read this when a consuming repository needs types for a schema it does
not declare — deciding whether to vendor at all, running
`link`/`vendor`/`vendor --check`/`outdated`, writing code against a
generated `contract.ts`, or debugging one of the ten coded vendoring
failures. Full narrative: `docs/guide/polyrepo.md`.

## Decide by repository boundary first — do not reach for `vendor` by default

**Same workspace → alias. Different repository → `vendor`.** If the
package that needs types is in the *same* pnpm/turbo workspace as the
package that declares the schema, import the declaring package directly
and write ordinary `db()` queries — no `link`, no `vendor`, no
`contract.ts`, no lock file. Only cross an actual repository boundary
(a different git repository — whether a remote polyrepo or a sibling
repository cloned locally next to this one) with `link`/`vendor`.
`hejbro link ../schema` inside a monorepo is a working but unnecessary
detour: the alias is shorter and its types update in the same
type-check run, with nothing to commit beyond your own code.

## The loop

`hejbro link <repository>` (once; a git URL or a local path, both
first-class) → `hejbro vendor` (writes `.hejbro/vendor/{schema.json,
snapshot.sql, contract.ts}` and `hejbro.lock`) → `import { createDb }
from "./.hejbro/vendor/contract"` → `createDb(driver)` → ordinary
`select`/`insert`/`update`/`deleteFrom` chains, identical to a `db()`
built from local declarations. Re-run `vendor` to move the pin forward;
run `vendor --check` (offline, writes nothing) in CI.

```ts prelude=polyrepo-contract
// createDb/driver below stand in for `import { createDb } from
// "./.hejbro/vendor/contract"` and your own pgDriver(pool) — see the
// prelude comment for why this snippet can't import a real generated file.
import { eq } from "hejbro";

const db = createDb(driver);
const post = await db.posts.select().where(eq(db.posts.columns.id, "some-id"));
```

`createDb`'s return value has no `Table`-typed member anywhere in its
public surface — a vendored contract cannot be passed anywhere a
declaration-authority-carrying table is expected (`generateMigration`,
`existingTable`, …). It carries only what a consumer needs to read and
write rows: `columns` (plain expressions, usable with `eq`/`and`/`or`
the same as any other query), `select`/`insert`/`update`/`delete`.

## Migrating an annotation that named the general `Table` type

If you have an existing declaration variable explicitly annotated with
the general `Table` type — `const posts: Table = table(app, "posts",
{...})` — and it now fails to satisfy something requiring a declared
table (e.g. passed into `generateMigration`), the fix is one line:
remove the annotation (let it infer) or narrow it to `DeclaredTable`.
`table()` itself has returned `DeclaredTable` since the migration-
authority brand landed; the wide `Table` type still exists (used across
this package's own generic constraints) but no longer satisfies
whatever specifically requires a real declaration.

## The ten failure codes

Every situation names its own code and tells you which repository the
remedy is in — most stay in yours, two (`vendor-export-missing`,
`vendor-export-invalid`) send you to the schema repository, one
(`vendor-export-format-unsupported`) tells you to upgrade `hejbro`
itself. Full table: `docs/guide/polyrepo.md`'s own failure table — do
not restate it here; two copies of the same ten-item list is exactly
the kind of drift this project avoids elsewhere.

## `--strict` and non-interactive runs

`vendor --check`/`vendor` accept `--strict`/`--no-strict`. Without
either, a non-interactive run (no TTY — this includes piped output, not
only recognized CI environments) fails by default; an interactive one
warns. If a command that looked fine locally suddenly fails once piped
or run in CI, this is why — pass `--no-strict` to keep it a warning
there too.
