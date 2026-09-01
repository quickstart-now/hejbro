# Schema across repositories

A schema repository declares its tables with `table()`, generates
migrations, and commits an **export** — a portable intermediate
representation (IR) of what it declared, never the declarations
themselves. A consuming repository (one that does not own the schema)
**vendors** that export over git: `link` records where it comes from,
`vendor` fetches one commit's worth of it and writes four committed
files, including a generated `contract.ts` the consumer imports to get
typed reads and writes against the same schema — with no database
connection and no second copy of the query language.

What crosses is the IR and the contract it produces. What never crosses:
declarations (a Go consumer never needs Node to read a schema), a live
database connection, or anything requiring the schema repository and
the consumer to run the same toolchain version in lockstep — format
skew between them is handled explicitly (see below).

## Three ways a consumer can be positioned — pick by repository boundary

**If you're in the same workspace, use an alias. Only cross a repository
boundary with `vendor`.**

1. **Monorepo (same workspace).** A package that declares a schema and a
   package that queries it, both in the same repository, both built by
   the same `pnpm`/`turbo` graph. The consuming package **imports the
   declaring package directly** (a workspace alias — `import { posts }
   from "@acme/schema"`) and writes ordinary `db()` queries against
   those declarations, exactly as if it had declared them itself. Edit
   a column's type and dependent query types change in the same
   type-check run — no generation step, no contract file, no lock, no
   `vendor` step. This is the *default* case in a monorepo, and it's
   the reason link/vendor exist at all only for the next two shapes.
2. **Polyrepo (a real repository boundary).** The consuming repository
   is a different git repository from the one that owns the schema.
   This is what this whole guide is about: `link` once, `vendor`
   whenever the pin needs to move, `vendor --check` in CI.
3. **Neighbor checkout (a separate repository, cloned locally).** Two
   git repositories, sitting side by side on disk during local
   development — still a real repository boundary, so it's `vendor`,
   the same as case 2, except `link`'s argument is a local filesystem
   path instead of a remote URL. `hejbro link ../schema` is exactly as
   first-class a source as a URL.

**The trap**: reaching for `hejbro link ../schema` *inside* a monorepo,
because the schema happens to live in a directory one level up. That's
an unnecessary detour — the alias (case 1) is shorter, its types update
immediately instead of after a `vendor` run, and it leaves nothing to
commit beyond your own code. The line between case 1 and case 3 is not
"is the other schema nearby on disk" — it's **whether it's a different
repository**.

## The command surface

Four commands, all in the consuming repository — plus the schema
repository's own `generate --export`, covered separately below:

- **`hejbro link <repository>`** — records the source (a git URL or a
  local path) in `hejbro.json`. Repository only: no branch, no ref, no
  commit. Never touches `hejbro.lock`.
- **`hejbro vendor`** — resolves the linked source's default branch (or
  `--ref <name>` for one run only — it never persists), fetches that
  commit's export, and writes `.hejbro/vendor/schema.json`,
  `.hejbro/vendor/snapshot.sql`, `.hejbro/vendor/contract.ts`, and
  `hejbro.lock`. Running it again moves the pin forward the same way —
  there is no separate "update" command, just `vendor` again.
- **`hejbro vendor --check`** — recomputes the three vendored files'
  hashes and compares them against `hejbro.lock`, entirely offline.
  Writes nothing. This is the command CI runs.
- **`hejbro outdated`** — advisory only, never fails on staleness:
  reports whether the linked source's default branch has moved past
  what's vendored. (This one does reach the network, the same as
  `vendor`, but it's a separate, optional check — not part of the
  build path.)

A schema-owning repository doesn't run any of these — it runs
`hejbro generate --export` (below) and commits the result.

Not built here: a database-fallback path (`pull --db-url`, reading an
existing database's shape when the owning repository doesn't use
hejbro) is tracked separately (#604) and does not exist yet.

## Day-to-day, only `vendor` needs the network

Every other command — building, type-checking, `vendor --check` — reads
committed files only. That's the entire reason the IR exists as a
committed artifact rather than something fetched at build time: an
agent sandbox with no network and no database can still type-check a
consumer's code, because everything it needs is already in the tree.
Only moving the pin forward (`vendor`) reaches out.

## The five files, and the pair they form

|  | Committed | Written by | Carries |
|---|---|---|---|
| `hejbro.json` | yes | `link` | **intent** — which repository to vendor from |
| `hejbro.lock` | yes | `vendor` | **truth** — the exact commit, ref, description format, and the vendored files' hashes |
| `.hejbro/vendor/schema.json`, `.hejbro/vendor/snapshot.sql` | yes | `vendor` | the IR and the squashed SQL, read back byte-for-byte from the resolved commit |
| `.hejbro/vendor/contract.ts` | yes | `vendor` | the `Database` interface, `contractMetadata`, and `createDb(conn)` — this is what your code imports |

`hejbro.json`/`hejbro.lock` are a pair the same way `package.json` and
`package-lock.json` are: one states what you want, the other is a
verifiable record of what you actually have, and a reviewer sees a
schema move as an ordinary file change in a pull request rather than
something buried in a hidden directory.

```ts
// .hejbro/vendor/contract.ts (generated by `hejbro vendor` — illustrative)
import type { Driver } from "hejbro";
import { createNameKeyedDb } from "hejbro";

export interface Database {
	readonly Tables: {
		posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
			readonly Relationships: readonly [];
		};
	};
	readonly Views: { [key: string]: never };
	readonly Functions: { [key: string]: never };
	readonly Enums: {};
}

export const contractMetadata = {
	commit: "a1b2c3d4...",
	exportHash: "sha256:...",
	roles: [] as const,
	tables: {
		posts: {
			schema: "app",
			name: "posts",
			columns: { id: { sqlName: "id", typeNode: { typeName: "uuid" }, mode: null, notNullElements: false } },
			foreignKeys: [],
		},
	},
} as const;

export const createDb = (conn: Driver) =>
	createNameKeyedDb<Database>(conn, contractMetadata);
```

```ts
// your own code
import { pgDriver } from "@hejbro/pg";
import { createDb } from "./.hejbro/vendor/contract";

const db = createDb(pgDriver(pool));
const rows = await db.posts.select();
```

## `--strict`, and what happens without a TTY

`vendor --check` (and `vendor` itself, for the situations that can apply
to it) accepts `--strict`/`--no-strict`. An explicit flag always wins.
With neither: an interactive terminal warns and continues; a
**non-interactive** run — CI, or output piped to a file — **fails by
default**. This applies the moment output isn't a TTY, not only under a
recognized CI environment variable, so a command that behaves fine when
you type it and then suddenly fails when piped (`hejbro vendor --check
| tee log`) is not a bug — pass `--no-strict` there if you want the
lenient behavior piped too.

## The schema repository's own half

The repository that owns the schema runs `hejbro generate --export` to
write `.hejbro/export/` alongside its normal migration, and commits it.
`hejbro verify` then optionally checks that the committed export still
matches the current declarations (only once a repository has opted in
by having an export directory at all) — the schema repository's own
guarantee that its default branch's export is trustworthy for every
consumer vendoring from it.

## Eleven named ways vendoring can fail

Each is its own code with its own remedy, and the remedy is what
decides which repository gets a separate code: most send you back to
your own repository, two send you to the repository that owns the
schema, one sends you to upgrade hejbro itself. Scoped to the process
of obtaining and checking a vendored schema (`link`/`vendor`/`vendor
--check`/`outdated`) — whether the `git` binary those commands depend
on is even installed is a different, already-owned question (a missing
`git` is its own coded failure, `error[vendor-git-missing]`, but it
isn't counted here).

| Situation | Code | Remedy sends you to |
|---|---|---|
| No source is linked | `error[vendor-source-not-linked]` | Your repository — run `hejbro link <repository>` |
| The remote cannot be reached or does not exist | `error[vendor-remote-unreachable]` | Your repository — check the URL/path, network, credentials |
| `--ref` does not resolve | `error[vendor-ref-not-found]` | Your repository — fix the ref, or omit `--ref` |
| The resolved commit carries no export | `error[vendor-export-missing]` | **The schema repository** — it needs to run `generate --export` and commit the result |
| The export does not answer its own format | `error[vendor-export-invalid]` | **The schema repository** — regenerate, or identify what wrote it |
| The export's format is newer than this toolchain knows | `error[vendor-export-format-unsupported]` | **Your own hejbro install** — upgrade it |
| The lock names a commit the remote no longer has | `error[vendor-lock-commit-lost]` | Your repository — a deliberate `--force`, or find out why the schema repository's history changed |
| The vendored files disagree with the lock | `error[vendor-check-mismatch]` | Your repository — re-run `vendor`, or revert the hand edit |
| The destination holds a file this tool did not write | `error[vendor-destination-not-vendored]` | Your repository — move/remove the file, or `--force` |
| The lock was resolved from somewhere other than the default branch | `error[vendor-lock-non-default-ref]` | Your repository — re-vendor from the default branch, or accept it deliberately (`--no-strict` at the boundary) |
| `vendor --check` runs before anything has ever been vendored | `error[vendor-not-yet-vendored]` | Your repository — run `hejbro vendor` first |

A local replacement — an uncommitted, gitignored override of the
committed source used for local iteration — is not among these eleven:
it belongs to a `replace` mechanism this change does not build. A
*committed* source that happens to be a local filesystem path (case 3
above) is not that situation; it's an ordinary, first-class
configuration.

Being behind the newest commit is deliberately not a failure at all —
that's `outdated`'s own advisory, and a lock naming an older commit is
doing exactly its job.
