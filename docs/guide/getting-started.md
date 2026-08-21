# Getting Started

hejbro is pre-alpha and not yet published to npm (see the repo [Status](../../README.md#status)). Until then, add it as a pnpm workspace dependency or build the repo locally.

```json
// package.json
{ "dependencies": { "hejbro": "workspace:*" } }
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
wrote migrations/20260821013035_add_app.sql
-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]
-- parent-snapshot: sha256:f86ae7ebc6d8bd93524149ab39f929814ff7413a6e5e1cfdb1d21367bf9bd295
-- snapshot: sha256:bbbb3da456292b8f95558af28191cd1aa733843d80eb41a5eaff437571c950e7
```

## Reading the banner

Every migration file opens with a structured comment — read this before you read the SQL below it:

```
-- hejbro migration
-- + table app.posts [new]
-- parent-snapshot: sha256:<hex>
-- snapshot: sha256:<hex>
```

`+`/`~`/`-` mean added/changed/dropped. The two hash lines chain this migration to the one before it — `hejbro verify` walks them to catch two branches that both extended the same snapshot state.

```sql
-- hejbro migration
-- + schema app [new]
-- + table app.posts [new]
-- parent-snapshot: sha256:f86ae7ebc6d8bd93524149ab39f929814ff7413a6e5e1cfdb1d21367bf9bd295
-- snapshot: sha256:bbbb3da456292b8f95558af28191cd1aa733843d80eb41a5eaff437571c950e7

create schema "app";

create table "app"."posts" (
	"id" uuid not null default gen_random_uuid(),
	"title" text not null,
	primary key ("id")
);
```

## `hejbro verify`

Re-derives the whole chain from checked-out files only — no live database. Four checks: the snapshot file parses; declarations rebuild to byte-identical snapshot text; the migration files' hash chain is linear; the chain's tip hash matches the current snapshot.

```
hejbro verify
```

```
verify: 4 checks passed (1 migrations, snapshot sha256:bbbb3da45629…)
```

## Next

- [Renames](renames.md) — what happens when `generate` can't tell a rename from an unrelated drop+add.
- [CI](ci.md) — wiring `hejbro verify` into GitHub Actions.
