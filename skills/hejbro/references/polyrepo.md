# Schema across repositories (link / vendor)

Read this when a consuming repository needs types for a schema it does
not declare — deciding whether to vendor at all, running
`link`/`vendor`/`vendor --check`/`outdated`, writing code against a
generated `contract.ts`, or debugging one of the eleven coded vendoring
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
`existingTable`, …). Tables carry `columns` (plain expressions, usable
with `eq`/`and`/`or` the same as any other query), `select`/`insert`/
`update`/`delete`. A bare `insert`/`update`/`delete` (no `.returning()`
— not yet exposed on this surface) sends no `RETURNING` clause and
types as resolving to `ReadonlyArray<never>`, never the table's row
type; read written rows back with a second `select`.

A vendored contract also carries every `defineFunction` declaration the
schema repository exports, callable through `db.fn` — `createDb(driver)
.fn.searchByStatus({ status: "published" })`, the same typed surface
`query-layer.md` documents for a local `db()` handle. `db.as(context).fn`
carries over unchanged: a scoped handle's `fn` calls the same vendored
functions, inside that context's transaction.

**Two different keying rules, not one.** `Tables` is keyed by the
table's own SQL name (matching `db()`'s own table-name keying);
`Functions` is keyed by the function's own **export name** from the
schema module, never its SQL name. A reader who only sees one of the two
groups tends to assume both follow the same rule — they don't.

## Existing tables cross the boundary too

An `existingTable()` declaration (D41, amended by add-unmanaged-objects
#605) — a platform-owned table like Supabase's `authUsers`, declared for
its shape and never for its DDL — vendors like any other: it reaches
`.hejbro/vendor/contract.ts`'s own `Tables` entry with the same `Row`/
`Insert`/`Update` a managed table gets, its client metadata is marked
existing, and a managed table's foreign key onto it resolves to a
relation in the contract exactly as one onto a managed table does (an
undeclared target still has none). `createDb(driver)` reads it plainly,
the same as any other table — `db.authUsers.select()`, no different
shape than a managed one. **What this does not give you yet**:
*following* that relation from the client — the name-keyed chain has no
`.related()` for any table, managed or existing (opening that surface is
separate work, #653) — so a consumer reads the existing table and the
managed table each on their own, not as one nested/joined query.

## A database as a marked fallback (`pull`)

`link`/`vendor` read a schema *repository* only — `link` itself records
nothing but a git URL or a local path ("Repository only" above). When
that repository genuinely isn't reachable, `hejbro pull --db-url
<db> --schema <name>` is the separate, marked fallback: it reads a
live database's catalog instead (the same reading `import` uses,
`packages/cli/src/infer/compose.ts`'s `inferFromCatalog`) and writes
into the exact same destination `vendor` does — `.hejbro/vendor/
{schema.json, snapshot.sql, contract.ts}` and `hejbro.lock` — so
`createDb`/the rest of "The loop" above work identically either way.
The contract's own header says it was inferred from a database rather
than vendored, and the lock it leaves carries no commit — `vendor
--check` and `outdated` both refuse to run against it (naming `link` as
the way to a commit-anchored contract instead), since there is no
commit to compare a database-sourced pin against. Reach for `pull` only
as the fallback it's named for; once the schema repository is
reachable, `link`+`vendor` replace the same destination with a
commit-anchored one.

`contract.ts`'s own `contractMetadata` constant carries this same
distinction at the type level (`@hejbro/query`'s `ContractMetadata`,
consumed by `createDb`): it's a union on a `source` field, `"git"`
(`commit`/`exportHash`, `vendor`'s own) or `"database"` (`database`/
`schemas`, `pull`'s own) — code written against it that forgets the
database-sourced case fails to compile rather than surfacing only once
someone runs `pull`. A contract a pre-#604 `hejbro vendor` already
wrote and committed carries no `source` key at all, and keeps
type-checking unchanged after upgrading `hejbro`/`@hejbro/query` alone
— `source` is optional on the git-sourced shape for exactly that
reason (never on the database-sourced one, which always names itself).

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

## The eleven failure codes

Every situation names its own code and tells you which repository the
remedy is in — most stay in yours, two (`vendor-export-missing`,
`vendor-export-invalid`) send you to the schema repository, one
(`vendor-export-format-unsupported`) tells you to upgrade `hejbro`
itself. Scoped to obtaining and checking a vendored schema — a missing
`git` binary (`vendor-git-missing`) is a real coded failure but belongs
to a different, already-owned requirement (`cli-commands`'s own
"external tool is an optional dependency"), not this count. Full table:
`docs/guide/polyrepo.md`'s own failure table — do not restate it here;
two copies of the same eleven-item list is exactly the kind of drift
this project avoids elsewhere.

## `--strict` and non-interactive runs

`vendor --check`/`vendor` accept `--strict`/`--no-strict`. Without
either, a non-interactive run (no TTY — this includes piped output, not
only recognized CI environments) fails by default; an interactive one
warns. If a command that looked fine locally suddenly fails once piped
or run in CI, this is why — pass `--no-strict` to keep it a warning
there too.
