# hejbro

<!-- crap-badge:start -->
[![CRAP ≤ 5 · 0 / 1024](https://img.shields.io/badge/CRAP%20%E2%89%A4%205-0%20%2F%201024-brightgreen)](#status)
<!-- crap-badge:end -->

> hej (Swedish: "hello") + bro (Swedish: "bridge") — hello, bridge.

**TypeScript-native Postgres schema & RPC management.** Declare everything in
your database — tables, RLS, functions, triggers, views, grants — in
TypeScript, and generate deterministic migration SQL from the diff.

The safe middle ground between letting AI touch your database directly (MCP)
and writing raw SQL by hand: everything is code, every change is a
reviewable, generated migration.

## Install

```bash
pnpm add hejbro
# using the Supabase preset?
pnpm add @hejbro/supabase
```

## 60 seconds

```ts
// hejbro.config.ts
import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/app.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "index",
	presets: [],
});
```

```ts
// src/app.schema.ts
import {
	defineFunction, eq, grant, isNull, now, rls,
	roleName, schema, table, text, timestamptz, update, uuid,
} from "hejbro";

export const app = schema("app");
export const appReaderRole = roleName("app_reader");

export const projects = table(app, "projects", {
	id: uuid().primaryKey().defaultRandom(),
	name: text().notNull(),
	archivedAt: timestamptz(),
}, (t) => ({
	rls: rls.enabled({
		readAll: rls.policy("projects_read_all").for("select")
			.to(appReaderRole).using(isNull(t.archivedAt)),
	}),
}));

export const appUsage = grant(app).usage.to(appReaderRole);

export const archiveProject = defineFunction(
	app, "archive_project",
	{ args: { projectId: uuid() }, returns: projects, security: "definer" },
	(ctx, { projectId }) => {
		ctx.return(
			update(projects).set({ archivedAt: now() })
				.where(eq(projects.id, projectId)).returning(),
		);
	},
);
```

```bash
hejbro generate
```

```sql
-- hejbro migration
-- hejbro: 0.1.0
-- + schema app [new]
-- + table app.projects [new]
-- + function app.archive_project [new]
-- + rls app.projects [new]
-- + policy app.projects.projects_read_all [new]
-- + grant app.schema-usage.app_reader [new]
-- parent-snapshot: sha256:d379e957…
-- snapshot: sha256:c7a5883a…

create schema "app";

create table "app"."projects" (
	"id" uuid not null default gen_random_uuid(),
	…
);

…

grant usage on schema "app" to "app_reader";
```

## How it works

Declarations compile to a normalized snapshot; `hejbro generate` diffs it
against the last committed snapshot and emits one migration file per run,
with a banner comment summarizing every change. The snapshot is derived,
checked-in state — recovery is via git history, never regeneration from a
live database.

`hejbro verify` re-derives the migration chain purely from checked-out files
(no live DB): each migration's banner carries `parent-snapshot`/`snapshot`
hash lines, so two branches that extended the same state and got merged
out of order are caught before they reach a real database.

Schema diffing is well-trodden (drizzle-kit, Atlas); the TypeScript →
PL/pgSQL builder compiler for functions and triggers is the novel part.

## Packages

| Package | Role |
|---------|------|
| `hejbro` | User-facing package: the DSL + CLI (`hejbro init`, `hejbro generate`, `hejbro verify`) |
| `@hejbro/core` | Declaration model, builder DSL, compiler, snapshot & diff engine (pure) |
| `@hejbro/supabase` | Supabase provider preset (auth helpers, storage buckets, role presets) |
| `@hejbro/skills` | Agent skills that teach coding agents the hejbro workflow |

Generic Postgres at the core; provider presets for Supabase first, with Neon
and Nile planned on the same extension interface.

## Examples

- [`examples/postgres`](examples/postgres) — plain Postgres: CHECK
  constraints, partial/ordered indexes, a GIN index with an operator class,
  an expression index, a self-referencing FK, RLS, a trigger, grants, a
  view.
- [`examples/supabase`](examples/supabase) — the Supabase preset: role
  presets, `authUsers`, `authUid()`, a storage bucket.

Roles are cluster-level objects hejbro never creates — both examples seed
theirs (`seed/`).

Both carry a four-step migration history and a local round-trip against real
Postgres (a Docker daemon required — Docker Desktop, OrbStack, or colima):

```bash
pnpm build && pnpm --filter example-postgres roundtrip
```

Guides: [getting started](docs/guide/getting-started.md) ·
[indexes](docs/guide/indexes.md) · [renames](docs/guide/renames.md) ·
[CI](docs/guide/ci.md)

## For agents

```bash
npx skills add quickstart-now/hejbro
```

Teaches an agent the declaration DSL, the "no real JS control flow inside
function bodies" pitfall, and the `generate`/`verify` workflow.

## Built AI-natively

This project is developed by AI agents (Claude Code), openly: the design
specs, decision logs, and implementation plans in `docs/` are the actual
artifacts the agents work from — not documentation written after the fact.

## Status

**Pre-1.0 — under active design and development.** Only the latest published
minor version is supported; see [`SECURITY.md`](SECURITY.md).

- Design spec: [`docs/specs/2026-08-19-hejbro-design.md`](docs/specs/2026-08-19-hejbro-design.md)
- Roadmap: [`docs/plans/2026-08-19-roadmap.md`](docs/plans/2026-08-19-roadmap.md)

<!-- crap:start -->
**Code quality gate:** every named function in `@hejbro/core`, `@hejbro/supabase`, `@hejbro/query` must score **CRAP ≤ 5** (CRAP = CC² × (1 − coverage)³ + CC; gated in CI). Current: **0 of 1024 functions** over the threshold, highest score 5.00 — measured at `89d81b0` (2026-08-26).
<!-- crap:end -->

## License

[MIT](LICENSE)
