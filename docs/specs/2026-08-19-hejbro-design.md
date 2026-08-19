# hejbro — Design Specification

Date: 2026-08-19
Status: Approved by the project owner. This document is the single source of
truth for what hejbro is and every design decision made so far. It was
produced in a brainstorming session between the owner and Claude; the
implementation is handed off to fresh Claude sessions running in this repo.

## 1. One-line definition

**hejbro** — declare *everything* in your Postgres database (tables, RLS,
functions, triggers, views, grants) in TypeScript, and generate deterministic
migration SQL from the diff.

Name: Swedish *hej* ("hello") + *bro* ("bridge") — "hello, bridge": a bridge
between TypeScript and Postgres. Fits the genre's naming convention (Kysely is
Finnish for "query"). npm names `hejbro` and PyPI `hejbro` were verified free
on 2026-08-19; the `@hejbro` npm scope (public org) is already owned by the
project owner (confirmed 2026-08-19). The GitHub org (`quickstart-now`) and
the npm scope intentionally differ: the scope follows the product brand, the
org follows the operating entity. Publishing remains owner-gated.

## 2. Motivation

The project owner runs production Supabase projects and hit this wall:

1. **MCP is not the answer for DB work.** Letting an AI create/alter/drop
   schema objects or RPCs through MCP is high-risk: changes are hard to
   review from the user's point of view and hard to trace afterwards.
2. **Raw SQL is not the answer either.** It is unintuitive and painful to
   review and maintain.
3. **Drizzle's declarative schema management is excellent but incomplete.**
   Tables and RLS are covered; functions (RPCs), triggers, grants, and
   storage objects are not. In practice this forces a hybrid where the
   uncovered objects live as hand-written SQL strings appended to migrations
   by convention (see `quickstart-labs/infra/*-supabase/sql/*.ts` for the
   real-world workaround that motivated this project).

hejbro closes that gap: **code is the single artifact an AI writes and a
human reviews; the migration SQL is generated, deterministic, and traceable.**

## 3. Decision log

Every decision below was made explicitly by the project owner during design.
Do not silently revisit them; if implementation reveals a blocker, surface it
and ask.

| # | Decision | Alternatives considered | Rationale |
|---|----------|------------------------|-----------|
| D1 | **Standalone tool**, not a Drizzle companion/wrapper | Drizzle companion (manage only "the rest"); drizzle-kit wrapper | Full freedom over the declaration model; no coupling to drizzle-kit internals |
| D2 | **Pure TS DSL compiled to plpgsql** for function bodies | Signature-in-TS + SQL-string body; .sql files + declaration headers | The compiler *is* the novelty; bodies become typed, reviewable code |
| D3 | **v1 ships both** the compiler and the schema/diff engine | Compiler first; schema engine first | Owner wants the full vision in v1 (decomposition happens at the plan level, not the product level) |
| D4 | Compile mechanism: **builder DSL with execution tracing** (option A) | TS AST static analysis (B); hybrid (C) | Realistic implementation cost; the API surface *is* the supported boundary; TS inference comes free. B builds a full compiler frontend and hides semantic traps (code that looks like TS but behaves like SQL). C is a possible later extension on top of A |
| D5 | **Generic Postgres core + provider presets** | Supabase-only; generic-only | Wider open-source audience, no vendor lock; Supabase pain solved via the first preset. Owner explicitly wants **Neon and Nile presets later**, so the preset interface is a first-class extension point, not a special case |
| D6 | **Snapshot-based diff** (drizzle-kit style) | Live-DB introspection diff (Atlas style); snapshot + drift check | Deterministic, no DB connection, CI-friendly. Drift check against a live DB is a possible v2 command |
| D7 | v1 object scope: tables, columns, indexes, FKs, enums, functions, triggers **+ RLS policies + views + grants/roles + Supabase preset objects** | Narrower subsets | Owner chose full scope for v1 |
| D8 | Repo: **`quickstart-now/hejbro`** (org repo) | Personal repo; new org | Reuses existing org management/CI conventions |
| D9 | License: **MIT** | Apache-2.0 | Widest adoption, genre norm |
| D10 | Name: **hejbro** | plts, pgform, declpg (all verified free) | Owner's choice |
| D11 | "AI native" means the **development process**: this OSS is built by AI agents (Claude Code), openly. Agent skills for *users* of hejbro ship as a feature (`@hejbro/skills`) | AI-native as product identity | Owner's clarification |
| D12 | **Applying migrations is out of scope for v1.** hejbro generates SQL files; the user's existing pipeline (supabase CLI, GitHub integration, etc.) applies them | Built-in apply/push | Keeps core pure and deterministic; avoids owning credentials |
| D13 | Build tooling: **tsdown, ESM-only output**, Node ≥ 22 (decided 2026-08-19, Phase 1 brainstorm; amended 2026-08-19) | tsup; plain tsc; dual ESM+CJS | tsdown is tsup's endorsed successor; ESM-only avoids the dual-package hazard for a new dev tool. Node ≥ 22 is the runtime support floor promised to hejbro users; the repo's own toolchain requires ≥ 22.18.0 (tsdown's engines range). Amended 2026-08-19, owner-approved: Node 20 reached EOL 2026-04, so the original "Node ≥ 20" floor was raised |
| D14 | Migration filenames default to **Supabase-style timestamps**: `YYYYMMDDHHMMSS_<slug>.sql`, with a configurable prefix strategy (`timestamp` \| `index` \| `unix`) (decided 2026-08-19) | drizzle-style index prefix (`0001_`) as default | The owner hit real ordering mismatches between drizzle's default and the supabase CLI (`drizzle-kit generate --prefix supabase` exists for this reason); Supabase-first means Supabase-compatible by default |

## 4. Architecture

```
hejbro/  (quickstart-now/hejbro)
├── packages/
│   ├── core        # @hejbro/core — DSL + compiler + diff engine (PURE: no fs, no DB)
│   ├── cli         # hejbro — user-facing package: re-exports core DSL + CLI (init/generate)
│   ├── supabase    # @hejbro/supabase — first provider preset
│   └── skills      # @hejbro/skills — agent skills for hejbro users
├── examples/       # real declarations doubling as integration tests (first: dd.land port)
└── docs/           # this spec, roadmap, ADRs as they accrue
```

**Core purity is the load-bearing boundary.** `@hejbro/core` takes declaration
objects and returns SQL strings and diff structures. It never reads files,
never opens a connection. This makes golden-file testing trivial and future
launchers (e.g. a Vite plugin) cheap.

### 4.1 Provider preset interface (the Neon/Nile door)

Presets are built ONLY on a public extension interface of core. If a preset
needs a special case inside core, the interface is wrong — fix the interface.
A preset can contribute exactly four things:

1. **Custom object kinds** — e.g. Supabase storage bucket → compiles to
   `storage.buckets` inserts + policies. A Nile preset would add tenant-aware
   table helpers here.
2. **Role/grant presets** — Supabase: `anon` / `authenticated` /
   `service_role`; Neon and Nile bring their own role models.
3. **Typed expression helpers** — e.g. `auth.uid()` as a typed builder.
4. **Reserved-area protection lists** — schemas like `auth`, `storage`,
   `realtime`: excluded from diffing, warn when touched.

Consequently the diff engine is **pluggable over "object kinds"**: each kind
implements the four stages (declare → snapshot-serialize → diff → emit SQL).
Built-in kinds (table, function, trigger, …) use the same interface presets do.

## 5. DSL surface

Schema objects feel like Drizzle (familiarity is a feature); the
function/trigger builder is the novelty.

### 5.1 Tables, RLS, indexes

```ts
import { schema, table, uuid, text, timestamptz, rls, index, isNotNull } from "hejbro";

export const ddland = schema("ddland");

export const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull().unique(),
	publishedAt: timestamptz(),
}, (t) => ({
	rls: rls.enabled({
		select: rls.policy("anyone can read published")
			.for("select").to("anon", "authenticated")
			.using(isNotNull(t.publishedAt)),
	}),
	indexes: [index().on(t.publishedAt)],
}));
```

### 5.2 Functions (RPCs) — builder DSL

```ts
export const publishPost = defineFunction("ddland", "publish_post", {
	args: { postId: uuid() },
	returns: posts,              // table reference → emits `returns setof ddland.posts`
	security: "definer",
	grants: ["authenticated"],
}, (ctx, { postId }) => {
	const post = ctx.row(select(posts).where(eq(posts.id, postId)));
	ctx.if(isNotNull(post.publishedAt), () => {
		ctx.raise("already published: %", postId);
	});
	ctx.return(
		update(posts).set({ publishedAt: now() }).where(eq(posts.id, postId)).returning()
	);
});
```

Key properties:

- The body function is **executed once at build time**; every `ctx.*` /
  builder call records a node into an AST. Values like `post.publishedAt` are
  recording proxies (column references), not real values.
- **Real JS control flow is forbidden inside bodies** — a real `if` would
  bake in one branch at build time. Control flow uses DSL constructs:
  `ctx.if()`, `ctx.forEach()`, `ctx.while()` (added incrementally; v1 may
  start with a subset — see roadmap).
- `returns: posts` (a table object) is the hook for future client-type
  generation (e.g. supabase-js `Database` types). Not in v1; keep the door
  open.

### 5.3 Triggers — define + attach in one declaration

```ts
export const commentsSingleDepth = defineTrigger(comments, {
	name: "comments_single_depth",
	timing: "before",
	events: ["insert", { update: ["parentId", "postId"] }],
	forEach: "row",
}, (ctx, { new: row }) => { /* same builder DSL; OLD/NEW rows are typed from the table */ });
```

### 5.4 Views and grants

```ts
export const publishedPosts = defineView(ddland, "published_posts",
	select(posts).where(isNotNull(posts.publishedAt)));

export const ddlandGrants = grant(ddland).usage.to("authenticated", "anon");
```

## 6. Compile pipeline (`hejbro generate`)

```
load declarations → execute builders (collect trees) → validate
  → serialize snapshot → diff against previous snapshot → emit migration SQL
```

1. **Load** — `hejbro.config.ts` points at entry file(s); declarations are
   exported objects, so loading is registration.
2. **Execute builders** — function/trigger bodies run and record their trees.
   **Determinism guard: every body is executed twice; if the two trees
   differ, non-deterministic code (real JS branching, `Date.now()`, etc.)
   leaked in — hard error.** An ESLint plugin catching real `if`/`for` inside
   bodies is planned for v1.x as a second layer.
3. **Validate** — referential integrity (column references that don't exist,
   triggers on dropped tables), name collisions, and preset-provided checks
   (e.g. Supabase: exposed table without RLS → warning). Everything a
   compiler can catch before human review, catch here.
4. **Serialize snapshot** — one normalized JSON of the full declared state.
   For functions/triggers store the **compiled SQL body hash + structured
   signature**, not the full text — cheap and stable change detection.
5. **Diff** — per-kind strategies:

   | Kind | Change strategy |
   |------|-----------------|
   | Tables/columns | `alter table`; renames need interactive confirmation (same problem and solution as drizzle-kit) |
   | Functions | `create or replace`; signature changes (args/return) emit `drop` + `create` — the compiler knows in advance when Postgres would reject a replace |
   | Triggers | `drop trigger if exists` + `create` (idempotent recreate) |
   | Views | `create or replace view`; column removals emit `drop` + `create` |
   | RLS policies | `drop policy` + `create policy` (alter policy can't take expression changes in many cases; recreate is simpler) |
   | Grants | diff against previous snapshot → only the `grant`/`revoke` delta |

6. **Emit** — one migration file per generate run, named
   `YYYYMMDDHHMMSS_<slug>.sql` by default (Supabase-compatible ordering; see
   D14 — prefix strategy configurable in `hejbro.config.ts`, slug from
   `--name` or auto-derived from the first change). The clock is injected by
   the CLI so core stays pure. The file carries a **structured change
   summary as a banner comment**:

   ```sql
   -- hejbro migration
   -- + function ddland.publish_post(post_id uuid) [new]
   -- ~ trigger comments_single_depth on ddland.comments [body changed]
   -- - view ddland.stale_view [dropped]
   ```

   The banner is the product's soul: it is the first thing a human reads in a
   PR review. Its quality decides whether "review the generated SQL" is real
   or theater.

The snapshot file is committed alongside migrations, enabling a CI check that
declarations ↔ snapshot ↔ migrations agree.

## 7. Error handling principles

- Every compile error carries the **declaration site** (file + export name).
- Every error message states **why it failed AND what to do**, as a pair.
- The builder DSL's advantage (the API is the boundary) is completed by error
  message quality — this is a stated quality bar, not a nice-to-have.

## 8. Testing strategy (three layers)

1. **Golden files** — declaration → emitted SQL snapshot comparison. Core is
   pure, so this layer is the thickest and cheapest.
2. **Real Postgres round-trip** — CI applies generated migrations to a Docker
   Postgres, extracts state (`pg_dump`), compares against declarations.
   Catches "compiled fine but Postgres rejects it".
3. **Example-based** — `examples/` real schemas (first: dd.land port) run as
   whole-project integration tests.

## 9. Out of scope for v1 (explicit)

- Applying migrations to a database (D12)
- Live-DB drift check (`hejbro check`) — v2 candidate
- Hybrid authoring (real TS arrow functions for single-expression SQL
  functions) — possible later extension on top of the builder (D4)
- Client type generation from `returns` metadata — door kept open (§5.2)
- Neon / Nile presets — designed for (§4.1) but not built in v1

## 10. Conventions for this repository

- **All GitHub-facing text in English** (README, docs, issues, PRs, commits).
- pnpm + Turborepo; Biome (tabs, double quotes); commitlint (conventional
  commits, husky `commit-msg` hook) — all already scaffolded.
- TypeScript: strict; the owner's global `typescript-rules` skill applies
  (no `any`, no `let`/`var`, no `for`/`while` loops in our own source, no
  ternary, etc.).
- Publishing to npm requires explicit owner approval; the `@hejbro` scope is
  already owned by the project owner.

## 11. Positioning notes (for README/marketing, when the time comes)

- The pitch: *"The safe middle ground between letting AI touch your database
  and writing raw SQL — everything is code, every change is a reviewable,
  generated migration."*
- Precedent honesty: schema diffing is well-trodden (drizzle-kit, Atlas);
  the TS→plpgsql builder compiler is the novel part. Lead with it.
- This project is itself built AI-natively (D11); the design docs and plans
  in this repo are part of the public story.
