# Getting Started

Install the user-facing package (and the Supabase preset if you use it):

```bash
pnpm add hejbro
# using the Supabase preset?
pnpm add @hejbro/supabase
```

## `hejbro init`

Run it in your project root. It scaffolds three things — `hejbro.config.ts`, an empty `migrations/` directory, and an empty `hejbro.snapshot.json` — and never an example schema file. It's idempotent: rerunning it skips whatever already exists and always exits 0.

```
hejbro init
```

```
created hejbro.config.ts
created migrations/
created hejbro.snapshot.json
```

## Your first declaration

Declarations are plain exported objects — loading the file *is* registering them. Create `src/app.schema.ts`:

```ts
import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
```

`hejbro.config.ts`'s `entry` glob picks up the declaration files you point it at.

## `hejbro generate`

Diffs your declarations against the last committed snapshot and writes one migration file.

```
hejbro generate
```

```
hejbro generate
loaded 2 declarations
wrote migrations/20260822101852_add_app.sql
-- hejbro migration
-- hejbro: 0.1.0
-- + schema app [new]
-- + table app.posts [new]
-- parent-snapshot: sha256:d379e9576f63f1d63d29561b7366135984e883890a8efcb780b4e53648a77c7c
-- snapshot: sha256:bd905e603caa3c2de0f0afe0b0e00670806fce16bd0e5231de98850da2ad3d8c
```

## Reading the banner

Every migration file opens with a structured comment — read this before you read the SQL below it:

```
-- hejbro migration
-- hejbro: <version>
-- + table app.posts [new]
-- parent-snapshot: sha256:<hex>
-- snapshot: sha256:<hex>
```

`+`/`~`/`-` mean added/changed/dropped. The two hash lines chain this migration to the one before it — `hejbro verify` walks them to catch two branches that both extended the same snapshot state.

```sql
-- hejbro migration
-- hejbro: 0.1.0
-- + schema app [new]
-- + table app.posts [new]
-- parent-snapshot: sha256:d379e9576f63f1d63d29561b7366135984e883890a8efcb780b4e53648a77c7c
-- snapshot: sha256:bd905e603caa3c2de0f0afe0b0e00670806fce16bd0e5231de98850da2ad3d8c

create schema "app";

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	constraint "posts_pkey" primary key ("id")
);
```

## `hejbro verify`

Re-derives the whole chain from checked-out files only — no live database. Five checks: the snapshot file parses; no two migration files share a version; declarations rebuild to byte-identical snapshot text; the migration files' hash chain is linear; the chain's tip hash matches the current snapshot.

```
hejbro verify
```

```
verify: 5 checks passed (1 migrations, snapshot sha256:bd905e603caa…)
```

## Next

- [Renames](renames.md) — what happens when `generate` can't tell a rename from an unrelated drop+add.
- [CI](ci.md) — wiring `hejbro verify` into GitHub Actions.

## Snapshot format stability

The snapshot file (`hejbro.snapshot.json`) is a derived artifact: it
regenerates from your declarations, which are the truth. That gives the
format-version policy (D101) two standing guarantees:

- **A format bump never rewrites your migrations.** When hejbro's
  snapshot format moves (its `formatVersion` field), the next
  `hejbro generate` rewrites the snapshot only; a committed migration
  chain pinned by verify banners updates its tip banner and nothing
  else.
- **Version asymmetry always fails loudly.** An older hejbro refuses a
  newer snapshot with an explicit upgrade diagnostic; a newer hejbro
  regenerates an older snapshot silently and correctly. There is no
  `snapshot upgrade` command, because there is nothing to migrate.

Pre-1.0, the version may bump whenever the snapshot's shape grows.
From 1.0, a bump is at most a minor-version event, documented in the
changelog.
