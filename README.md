# hejbro

<!-- crap-badge:start -->
[![CRAP ≤ 5 · 0 / 1118](https://img.shields.io/badge/CRAP%20%E2%89%A4%205-0%20%2F%201118-brightgreen)](#status)
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
| `hejbro` | User-facing package: the DSL + query layer + CLI (`hejbro init`, `hejbro generate`, `hejbro verify`) |
| `@hejbro/core` | Declaration model, builder DSL, compiler, snapshot & diff engine (pure) |
| `@hejbro/query` | Typed query layer: statement compiler, driver contract, RLS execution context, thenable chain surface |
| `@hejbro/pg` | Vanilla node-postgres driver for `@hejbro/query` |
| `@hejbro/supabase` | Supabase provider preset (auth helpers, storage buckets, role presets) + a `@hejbro/query` driver decorator |
| `@hejbro/skills` | Agent skills that teach coding agents the hejbro workflow |

Generic Postgres at the core; provider presets for Supabase first, with Neon
and Nile planned on the same extension interface.

## Query layer

`hejbro` re-exports a typed query layer on the same declared schema: a
db-first, thenable chain surface — inert until awaited, and identical
across the unscoped handle, a `db.as(context)` scoped handle (RLS
execution context), and `tx` inside `db.transaction(...)`.

```bash
pnpm add @hejbro/pg pg
```

```ts
import { db, isNull } from "hejbro";
import { pgDriver } from "@hejbro/pg";
import * as schema from "./app.schema";

const handle = db(schema, pgDriver(process.env.DATABASE_URL!));

const active = await handle
	.select(schema.projects)
	.where(isNull(schema.projects.archivedAt));

// pure preview — same statement, zero driver interaction.
const { sql, params } = handle
	.select(schema.projects)
	.where(isNull(schema.projects.archivedAt))
	.compile();
```

Using Supabase instead? `supabaseDriver(pgDriver(pool))` decorates the same
driver contract with Supabase's roles, so `db.as(asUser(claims))` /
`db.as(asAnon())` (both from `@hejbro/supabase`) pass the declared-role
check.

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
**Code quality gate:** every named function in `@hejbro/core`, `@hejbro/supabase`, `@hejbro/query`, `@hejbro/pg` must score **CRAP ≤ 5** (CRAP = CC² × (1 − coverage)³ + CC; gated in CI). Current: **0 of 1118 functions** over the threshold, highest score 5.00 — measured at `317a7e5` (2026-08-27).
<!-- crap:end -->

<!-- ai-metrics:start -->
**AI-native development metrics** — this project is built by AI piece
teams under owner direction; each completed piece records its ledgers
(`openspec/task-times.csv`, `openspec/task-tokens.csv`) and this block
is refreshed at piece close-out by the lead (single writer). Time is
pure processing only (owner-decision waits and coordination excluded);
tokens are summed from the piece team's session transcripts — external
records, never self-reported. Formulas and dimension definitions: #305.

| Piece (change `add-query-layer`) | Tasks | Est → actual (pure min) | Review reworks | Output tokens | Requests | Cache hit |
|---|---|---|---|---|---|---|
| group 2 — compiler + sql | 6 | 54 → 174 ¹ | 1 | 881,848 | 898 | 99.0% |
| group 3 — type inference | 16 | 154 → 124 (0.81×) | 3 | 2,178,887 | 2,506 | 99.5% |
| group 4 — execution + drivers contract | 15 | 195 → 130 (0.67×) | 2 | 2,206,258 | 2,667 | 99.5% |
| group 6 — supabase driver + RLS context | 6 | 46 → 91 (2.0×) ² | 0 | 941,124 | 917 | 98.6% |
| group 5 — @hejbro/pg vanilla driver | 8 | 68 → ~256 (3.8×) ³ | 4 | 1,342,057 | 1,520 | 99.3% |

Named process-cost rows are kept separate from task rows (a decision
arriving mid-implementation, a red-first lapse, a gate widening between
bases) — summed they would read "estimates were right"; separated they
read "tasks were fast, process was expensive", which is the actionable
half. Session-wide tool-call failure rate: 1.9% (includes intentional
TDD red runs). ¹ group 2's time rows predate the pure-processing
measurement standard and include coordination waits. ² group 6's
overrun is deliberate strengthening (extra assertions later proven live
by review mutations) plus proving the integration wiring actually
works — scope the estimates had not counted, not estimation error;
the split is in the ledger notes. ³ group 5's implementer times are
self-reported approximations (reclassified from "measured" by the
implementer's own call — no timer ran), and the overrun is dominated
by requirements arriving across rounds: quality-gate wiring and
test-binding standards were not pre-settled in the re-plan — recorded
as a planning lesson, not implementer cost.
<!-- ai-metrics:end -->

## License

[MIT](LICENSE)
